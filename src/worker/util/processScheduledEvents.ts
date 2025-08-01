import { idb } from "../db/index.ts";
import g from "./g.ts";
import helpers from "./helpers.ts";
import logEvent from "./logEvent.ts";
import {
	league,
	expansionDraft,
	phase,
	team,
	player,
	finances,
	freeAgents,
} from "../core/index.ts";
import type {
	ScheduledEvent,
	Conditions,
	RealTeamInfo,
} from "../../common/types.ts";
import { PHASE, applyRealTeamInfo } from "../../common/index.ts";
import local from "./local.ts";

const processTeamInfo = async (
	info: Extract<ScheduledEvent, { type: "teamInfo" }>["info"],
	season: number,
	realTeamInfo: RealTeamInfo | undefined,
) => {
	// This happens in preseason, but after a new TeamSeason row is created, so update Team and TeamSeason

	const eventLogTexts: string[] = [];

	const teams = await idb.cache.teams.getAll();
	const t = teams.find((t2) => t2.tid === info.tid);
	if (!t) {
		throw new Error(`No team found in scheduled event: ${info.tid}`);
	}

	if (realTeamInfo) {
		applyRealTeamInfo(info, realTeamInfo, season);
	}

	const old = {
		region: t.region,
		name: t.name,
		imgURL: t.imgURL,
		imgURLSmall: t.imgURLSmall,
	};
	Object.assign(t, info);

	// If imgURL is defined in scheduled event but imgURLSmall is not, delete old imgURLSmall. Otherwise LAC wind up having a the Wings logo in imgURLSmall!
	const deleteImgURLSmall = info.imgURL && !info.imgURLSmall && t.imgURLSmall;

	if (deleteImgURLSmall) {
		delete t.imgURLSmall;
	}

	// Make sure this didn't fuck up the cid somehow, such as if the user moved a team to a new conference, but then the scheduled event only has the div because it assumes conference didn't change. THIS WOULD BE LESS LIKELY TO HAPPEN IF NEW DIVS/CONFS WERE NOT CREATED BEFORE TEAM DID/CID VALUES WERE UPDATED! https://mail.google.com/mail/u/0/#inbox/FMfcgxwKkRDqKPHCkJdLXcZvNCxhbGzn
	const divs = g.get("divs");
	const div = divs.find((div) => div.did === t.did) ?? divs[0];
	if (div) {
		t.did = div.did;
		t.cid = div.cid;
	} else {
		throw new Error("No divisions");
	}

	await idb.cache.teams.put(t);

	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[info.tid, season],
	);
	if (!teamSeason) {
		throw new Error(
			`No team season found in scheduled event: ${info.tid}, ${season}`,
		);
	}
	Object.assign(teamSeason, info);
	if (deleteImgURLSmall) {
		delete teamSeason.imgURLSmall;
	}
	teamSeason.did = div.did;
	teamSeason.cid = div.cid;
	await idb.cache.teamSeasons.put(teamSeason);

	let updatedRegionName;
	if (info.region && info.region !== old.region) {
		const text = `the ${old.region} ${
			old.name
		} are now the <a href="${helpers.leagueUrl([
			"roster",
			t.abbrev,
			season,
		])}">${t.region} ${t.name}</a>.`;

		eventLogTexts.push(`<b>Team relocation:</b> ${text}`);
		updatedRegionName = true;

		logEvent({
			text: helpers.upperCaseFirstLetter(text),
			type: "teamRelocation",
			tids: [t.tid],
			showNotification: false,
			score: 20,
		});
	} else if (info.name !== undefined && info.name !== old.name) {
		const text = `the ${old.region} ${
			old.name
		} are now the <a href="${helpers.leagueUrl([
			"roster",
			t.abbrev,
			season,
		])}">${t.region} ${t.name}</a>.`;

		eventLogTexts.push(`<b>Team rename:</b> ${text}`);
		updatedRegionName = true;

		logEvent({
			text: helpers.upperCaseFirstLetter(text),
			type: "teamRename",
			tids: [t.tid],
			showNotification: false,
			score: 20,
		});
	} else if (info.imgURL && info.imgURL !== old.imgURL) {
		logEvent({
			text: `The <a href="${helpers.leagueUrl(["roster", t.abbrev, season])}">${
				t.region
			} ${t.name}</a> got a new logo:<br><img src="${
				t.imgURL
			}" class="mt-2" style="max-width:120px;max-height:120px;">`,
			type: "teamLogo",
			tids: [t.tid],
			showNotification: false,
			score: 20,
		});
	}

	await league.setGameAttributes({
		teamInfoCache: teams.map((t) => ({
			abbrev: t.abbrev,
			disabled: t.disabled,
			imgURL: t.imgURL,
			imgURLSmall: t.imgURLSmall,
			name: t.name,
			region: t.region,
		})),
	});

	if (info.tid === g.get("userTid") && updatedRegionName) {
		await league.updateMeta();
	}

	return eventLogTexts;
};

const processGameAttributes = async (
	info: Extract<ScheduledEvent, { type: "gameAttributes" }>["info"],
) => {
	const eventLogTexts: string[] = [];

	const texts: string[] = [];
	if (
		info.threePointers !== undefined &&
		info.threePointers !== g.get("threePointers")
	) {
		texts.push(
			info.threePointers
				? "Added a three point line."
				: "Removed the three point line.",
		);
	}
	const prevSalaryCapType = g.get("salaryCapType");
	const newSalaryCapType = info.salaryCapType ?? prevSalaryCapType;
	const prevSalaryCap = g.get("salaryCap");
	const newSalaryCap = info.salaryCap ?? prevSalaryCap;
	if (
		info.salaryCapType !== undefined &&
		info.salaryCapType !== prevSalaryCapType
	) {
		if (info.salaryCapType === "none") {
			texts.push("Salary cap was eliminated.");
		} else if (prevSalaryCapType === "none") {
			texts.push(
				`${helpers.upperCaseFirstLetter(
					info.salaryCapType,
				)} salary cap added at ${helpers.formatCurrency(
					newSalaryCap / 1000,
					"M",
				)}.`,
			);
		} else {
			texts.push(
				`Salary cap switched to a ${
					info.salaryCapType
				} cap of ${helpers.formatCurrency(newSalaryCap / 1000, "M")}.`,
			);
		}
	} else if (
		info.salaryCap !== undefined &&
		info.salaryCap !== prevSalaryCap &&
		newSalaryCapType !== "none"
	) {
		const increased =
			info.salaryCap > prevSalaryCap ? "increased" : "decreased";
		texts.push(
			`Salary cap ${increased} from ${helpers.formatCurrency(
				prevSalaryCap / 1000,
				"M",
			)} to ${helpers.formatCurrency(info.salaryCap / 1000, "M")}.`,
		);
	}

	const prevNumPlayoffByes = g.get("numPlayoffByes", "current");
	if (
		info.numPlayoffByes !== undefined &&
		info.numPlayoffByes !== prevNumPlayoffByes
	) {
		const increased =
			info.numPlayoffByes > prevNumPlayoffByes ? "increased" : "decreased";
		texts.push(
			`Playoff byes ${increased} from ${prevNumPlayoffByes} to ${info.numPlayoffByes}.`,
		);
	}

	const prevNumGamesPlayoffSeries = g.get("numGamesPlayoffSeries", "current");
	if (
		info.numGamesPlayoffSeries !== undefined &&
		JSON.stringify(info.numGamesPlayoffSeries) !==
			JSON.stringify(prevNumGamesPlayoffSeries)
	) {
		if (
			prevNumGamesPlayoffSeries.length !== info.numGamesPlayoffSeries.length
		) {
			const increased =
				info.numGamesPlayoffSeries.length > prevNumGamesPlayoffSeries.length
					? "increased"
					: "decreased";
			texts.push(
				`Playoffs ${increased} from ${prevNumGamesPlayoffSeries.length} to ${info.numGamesPlayoffSeries.length} rounds`,
			);
		} else {
			texts.push("New number of playoff games per round.");
		}
	}

	const prevNumGames = g.get("numGames");
	if (info.numGames !== undefined && info.numGames !== prevNumGames) {
		const increased = info.numGames > prevNumGames ? "lengthened" : "shortened";
		texts.push(
			`Regular season ${increased} from ${prevNumGames} to ${info.numGames} games.`,
		);
	}

	const prevPlayIn = g.get("playIn");
	if (info.playIn !== undefined && info.playIn !== prevPlayIn) {
		if (info.playIn) {
			texts.push(`Play-in tournament added before the playoffs.`);
		} else {
			texts.push(`Play-in tournament removed.`);
		}
	}

	const prevDraftType = g.get("draftType");
	if (info.draftType !== undefined && info.draftType !== prevDraftType) {
		texts.push(
			`New <a href="${helpers.leagueUrl([
				"draft_lottery",
			])}">draft lottery</a> format.`,
		);
	}

	const prevAllStarType = g.get("allStarType");
	if (info.draftType !== undefined && info.allStarType !== prevAllStarType) {
		if (info.allStarType === "draft") {
			texts.push("All-Star teams will now be selected by a draft.");
		} else if (info.allStarType === "byConf") {
			texts.push("All-Star teams will now be selected by conference.");
		} else if (info.allStarType === "top") {
			texts.push(
				"All-Star teams will now be made up of the top players in the league, regardless of conference.",
			);
		}
	}

	const prevAllStarDunk = g.get("allStarDunk");
	if (info.allStarDunk !== undefined && info.allStarDunk !== prevAllStarDunk) {
		if (info.allStarDunk) {
			texts.push("A slam dunk contest has been added to the All-Star events.");
		} else {
			texts.push("The slam dunk contest has been removed.");
		}
	}

	const prevAllStarThree = g.get("allStarThree");
	if (
		info.allStarThree !== undefined &&
		info.allStarThree !== prevAllStarThree
	) {
		if (info.allStarDunk) {
			texts.push(
				"A three-point contest has been added to the All-Star events.",
			);
		} else {
			texts.push("The three-point contest has been removed.");
		}
	}

	const prevFoulsUntilBonus = g.get("foulsUntilBonus");
	if (
		info.foulsUntilBonus !== undefined &&
		JSON.stringify(info.foulsUntilBonus) !== JSON.stringify(prevFoulsUntilBonus)
	) {
		let text = "New number of team fouls until the bonus: ";

		if (info.foulsUntilBonus[0] === info.foulsUntilBonus[1]) {
			text += `${info.foulsUntilBonus[0]} in any regulation or overtime period`;
		} else {
			text += `${info.foulsUntilBonus[0]} in regulation periods, ${info.foulsUntilBonus[1]} in overtime periods`;
		}

		if (
			info.foulsUntilBonus[2] < info.foulsUntilBonus[0] ||
			info.foulsUntilBonus[2] < info.foulsUntilBonus[1]
		) {
			// If this condition is not true, then last 2 minutes rule basically does not exist
			text += `, ${info.foulsUntilBonus[2]} in the last 2 minutes of any period`;
		}

		texts.push(text);
	}

	const prevLuxuryTax = g.get("luxuryTax");
	if (info.luxuryTax !== undefined && info.luxuryTax !== prevLuxuryTax) {
		let text;
		if (prevLuxuryTax === 0) {
			text = `Luxury tax instituted for teams with payrolls over ${helpers.formatCurrency((info.luxuryPayroll ?? g.get("luxuryPayroll")) / 1000, "M")}`;
		} else {
			text = `Luxury tax changed from ${prevLuxuryTax} to ${info.luxuryTax}`;
		}
		texts.push(text);
	}

	for (const text of texts) {
		logEvent({
			text,
			type: "gameAttribute",
			tids: [],
			showNotification: false,
			score: 20,
		});
	}

	if (texts.length === 1) {
		eventLogTexts.push(`<b>League rule change:</b> ${texts[0]}`);
	} else if (texts.length > 1) {
		eventLogTexts.push(
			`<b>League rule changes:</b><br>- ${texts.join("<br>- ")}`,
		);
	}

	await league.setGameAttributes(info);

	return eventLogTexts;
};

const processExpansionDraft = async (
	info: Extract<ScheduledEvent, { type: "expansionDraft" }>["info"],
	season: number,
	realTeamInfo: RealTeamInfo | undefined,
	conditions: Conditions,
) => {
	const numProtectedPlayers =
		info.numProtectedPlayers !== undefined
			? info.numProtectedPlayers
			: g.get("minRosterSize") - info.teams.length;

	const teams = await idb.cache.teams.getAll();
	const expansionTeams = info.teams.filter((t) => {
		if (t.tid === undefined) {
			return true;
		}

		const t2 = teams[t.tid];

		// TEMP DISABLE WITH ESLINT 9 UPGRADE eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (!t2) {
			return true;
		}

		// If team is already enabled, no need for expansion draft
		return t2.disabled;
	});

	if (realTeamInfo) {
		for (const t of expansionTeams) {
			applyRealTeamInfo(t as any, realTeamInfo, season);
		}
	}

	if (expansionTeams.length === 0) {
		return [];
	}

	await league.setGameAttributes({
		expansionDraft: {
			phase: "setup",
			teams: expansionTeams,
			numProtectedPlayers: String(numProtectedPlayers),
		},
	});

	const errors = await expansionDraft.advanceToPlayerProtection(
		true,
		conditions,
	);
	if (errors) {
		throw new Error(errors.join("; "));
	}

	await phase.newPhase(PHASE.EXPANSION_DRAFT, conditions);

	return [
		`<b>Expansion draft!</b> ${expansionTeams.length} new team${
			expansionTeams.length > 1 ? "s are" : " is"
		} joining the league.`,
	];
};

const processContraction = async (
	info: Extract<ScheduledEvent, { type: "contraction" }>["info"],
) => {
	const t = await idb.cache.teams.get(info.tid);
	if (!t) {
		throw new Error(`No team found in scheduled event: ${info.tid}`);
	}

	await team.disable(t.tid);

	const text = `<b>Contraction!</b> The ${t.region} ${t.name} franchise is disbanding. All their players will become free agents.`;

	return [text];
};

const processUnretirePlayer = async (pid: number) => {
	const p = await idb.getCopy.players({ pid }, "noCopyCache");
	if (!p) {
		throw new Error(`No player found for scheduled event: ${pid}`);
	}

	// Player might need some new ratings rows added
	const lastRatingsSeason = p.ratings.at(-1)!.season;
	const diff = g.get("season") - lastRatingsSeason;
	if (diff > 0) {
		const scoutingLevel = await finances.getLevelLastThree("scouting", {
			tid: g.get("userTid"),
		});

		// Add rows one at a time, since we want to store full ratings history
		for (let i = 0; i < diff; i++) {
			player.addRatingsRow(p, scoutingLevel);

			// Adjust season, since addRatingsRow always adds in current season
			p.ratings.at(-1)!.season -= diff - i - 1;

			await player.develop(p, 1);
		}
	}

	p.retiredYear = Infinity;
	player.addToFreeAgents(p);
	await idb.cache.players.put(p);

	const ratings = p.ratings.at(-1)!;
	const ovr = player.fuzzRating(ratings.ovr, ratings.fuzz);

	// Only show notification if it's an above average player
	if (ovr > local.playerOvrMean) {
		const text = `<a href="${helpers.leagueUrl(["player", p.pid])}">${
			p.firstName
		} ${p.lastName}</a> has come out of retirement and is now a free agent.`;

		return [text];
	}

	return [];
};

const processScheduledEvents = async (
	season: number,
	phase: number,
	conditions: Conditions,
) => {
	if (g.get("repeatSeason")?.type === "playersAndRosters") {
		return;
	}

	const scheduledEvents = await idb.cache.scheduledEvents.getAll();
	const eventLogTexts: string[] = [];

	const realTeamInfo = (await idb.meta.get("attributes", "realTeamInfo")) as
		| RealTeamInfo
		| undefined;

	const unretiredPids = [];

	for (const scheduledEvent of scheduledEvents) {
		if (scheduledEvent.season !== season || scheduledEvent.phase !== phase) {
			if (
				scheduledEvent.season < season ||
				(scheduledEvent.season === season && scheduledEvent.phase < phase)
			) {
				await idb.cache.scheduledEvents.delete(scheduledEvent.id);
			}
			continue;
		}

		if (scheduledEvent.type === "teamInfo") {
			eventLogTexts.push(
				...(await processTeamInfo(scheduledEvent.info, season, realTeamInfo)),
			);
		} else if (scheduledEvent.type === "gameAttributes") {
			eventLogTexts.push(...(await processGameAttributes(scheduledEvent.info)));
		} else if (scheduledEvent.type === "expansionDraft") {
			eventLogTexts.push(
				...(await processExpansionDraft(
					scheduledEvent.info,
					season,
					realTeamInfo,
					conditions,
				)),
			);
		} else if (scheduledEvent.type === "contraction") {
			eventLogTexts.push(...(await processContraction(scheduledEvent.info)));
		} else if (scheduledEvent.type === "unretirePlayer") {
			unretiredPids.push(scheduledEvent.info.pid);
			eventLogTexts.push(
				...(await processUnretirePlayer(scheduledEvent.info.pid)),
			);
		} else {
			throw new Error(
				`Unknown scheduled event type: ${(scheduledEvent as any).type}`,
			);
		}

		await idb.cache.scheduledEvents.delete(scheduledEvent.id);
	}

	if (scheduledEvents.length > 0) {
		// Non-default scheduled events (or default plus bulk delete) could leave a team orphanied in a division or conference that no longer exists
		await team.ensureValidDivsConfs();
	}

	if (unretiredPids.length > 0) {
		await freeAgents.normalizeContractDemands({
			type: "freeAgentsOnly",
			pids: unretiredPids,
		});
	}

	if (eventLogTexts.length > 0) {
		logEvent({
			saveToDb: false,
			text: eventLogTexts.join("<br><br>"),
			type: "info",
		});
	}
};

export default processScheduledEvents;
