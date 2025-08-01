import { idb } from "../db/index.ts";
import { g, getProcessedGames, helpers } from "../util/index.ts";
import type {
	UpdateEvents,
	ViewInput,
	AllStars,
	Game,
} from "../../common/types.ts";
import { DEFAULT_TEAM_COLORS, PHASE } from "../../common/index.ts";

export type TeamSeasonOverride = {
	region?: string;
	name?: string;
	abbrev?: string;
	imgURL?: string;
	imgURLSmall?: string;
	colors?: [string, string, string];
};

export const setTeamInfo = async (
	t: any,
	i: number,
	allStars: AllStars | undefined,
	game: any,
	teamSeasonOverride?: TeamSeasonOverride,
) => {
	if (allStars) {
		const ind = t.tid === -1 ? 0 : 1;

		if (allStars.type === "byConf" || allStars.type === "top") {
			t.region = "";
			t.name = allStars.teamNames[ind];
		} else {
			// Covers type==="draft" and undefind type, from when draft was the only option
			t.region = "Team";
			t.name = allStars.teamNames[ind].replace("Team ", "");
		}

		if (allStars.type === "top") {
			t.abbrev = `AS${i === 0 ? 2 : 1}`;
		} else {
			t.abbrev = t.name.slice(0, 3).toUpperCase();
			if (i === 1 && t.abbrev === game.teams[0].abbrev) {
				t.abbrev = `${t.abbrev.slice(0, 2)}2`;
			}
		}

		t.imgURL = "";

		for (const p of t.players) {
			const entry = allStars.teams[ind].find((p2) => p2.pid === p.pid);
			p.abbrev = entry ? helpers.getAbbrev(entry.tid) : "";
			p.tid = entry ? entry.tid : g.get("userTid");
		}
	} else {
		const teamSeason =
			teamSeasonOverride ??
			(await idb.cache.teamSeasons.indexGet("teamSeasonsByTidSeason", [
				t.tid,
				game.season,
			]));
		if (teamSeason) {
			t.region =
				teamSeason.region ??
				(Object.hasOwn(g, "teamInfoCache")
					? g.get("teamInfoCache")[t.tid]?.region
					: "");
			t.name =
				teamSeason.name ??
				(Object.hasOwn(g, "teamInfoCache")
					? g.get("teamInfoCache")[t.tid]?.name
					: "");
			t.abbrev =
				teamSeason.abbrev ??
				(Object.hasOwn(g, "teamInfoCache")
					? g.get("teamInfoCache")[t.tid]?.abbrev
					: "");
			t.imgURL =
				teamSeason.imgURL ??
				(Object.hasOwn(g, "teamInfoCache")
					? g.get("teamInfoCache")[t.tid]?.imgURL
					: "");

			// Extra teamSeasonOverride check here because this could intentionally be undefined in the provided teamSeason
			t.imgURLSmall =
				teamSeason.imgURLSmall ??
				(Object.hasOwn(g, "teamInfoCache") && !teamSeasonOverride
					? g.get("teamInfoCache")[t.tid]?.imgURLSmall
					: undefined);
			t.colors = teamSeason.colors;
		} else if (Object.hasOwn(g, "teamInfoCache")) {
			t.region = g.get("teamInfoCache")[t.tid]?.region;
			t.name = g.get("teamInfoCache")[t.tid]?.name;
			t.abbrev = g.get("teamInfoCache")[t.tid]?.abbrev;
			t.imgURL = g.get("teamInfoCache")[t.tid]?.imgURL;
			t.imgURL = g.get("teamInfoCache")[t.tid]?.imgURL;
			t.imgURLSmall = g.get("teamInfoCache")[t.tid]?.imgURLSmall;
		} else {
			t.region = "";
			t.name = "";
			t.abbrev = "";
			t.imgURL = "";
			// imgURLSmall can be undefined. Probably imgURL should be too.
		}
	}

	if (!t.colors) {
		t.colors = DEFAULT_TEAM_COLORS;
	}
};

export const makeAbbrevsUnique = <T extends { abbrev: string }>(
	teams: [T, T],
) => {
	if (teams[0].abbrev === teams[1].abbrev) {
		teams[0].abbrev = `${teams[0].abbrev}2`;
		teams[1].abbrev = `${teams[1].abbrev}1`;
	}
};

/**
 * Generate a box score.
 *
 * @memberOf views.gameLog
 * @param {number} gid Integer game ID for the box score (a negative number means no box score).
 * @return {Promise.Object} Resolves to an object containing the box score data (or a blank object).
 */
const boxScore = async (gid: number) => {
	const game = await idb.getCopy.games({ gid });

	// If game doesn't exist (bad gid or deleted box scores), show nothing
	if (!game) {
		return { gid: -1 };
	}

	const allStarGame = game.teams[0].tid === -1 || game.teams[1].tid === -1;
	let allStars: AllStars | undefined;

	if (allStarGame) {
		allStars = await idb.getCopy.allStars(
			{
				season: game.season,
			},
			"noCopyCache",
		);

		if (!allStars) {
			return { gid: -1 };
		}
	}

	for (const i of [0, 1] as const) {
		const t = game.teams[i];
		await setTeamInfo(t, i, allStars, game);

		// Floating point errors make this off a bit
		t.min = Math.round(t.min);

		// Put injured players at the bottom, then sort by GS and roster position
		t.players.sort((a: any, b: any) => {
			// This sorts by starters first and minutes second, since .min is always far less than 1000 and gs is either 1 or 0. Then injured players are listed at the end, if they didn't play.
			return (
				b.gs * 100000 +
				b.min * 1000 -
				b.injury.gamesRemaining -
				(a.gs * 100000 + a.min * 1000 - a.injury.gamesRemaining)
			);
		});
	}
	makeAbbrevsUnique(game.teams as any);

	const wonInd = game.won.tid === game.teams[0].tid ? 0 : 1;
	const lostInd = wonInd === 0 ? 1 : 0;

	const overtimeText = helpers.overtimeText(game.overtimes, game.numPeriods);
	const overtime = overtimeText === "" ? "" : `(${overtimeText})`;

	if (game.numPeriods === undefined) {
		game.numPeriods = 4;
	}

	const game2 = {
		...game,
		overtime,

		// WARNING - won/lost . region/name/abbrev is used to distinguish between GameLog and LiveGame in BoxScore, so be careful if you change this!
		won: {
			...game.won,
			region: game.teams[wonInd].region,
			name: game.teams[wonInd].name,
			abbrev: game.teams[wonInd].abbrev,
			imgURL: game.teams[wonInd].imgURL,
			won: game.teams[wonInd].won,
			lost: game.teams[wonInd].lost,
			tied: game.teams[wonInd].tied,
			otl: game.teams[wonInd].otl,
			playoffs: game.teams[wonInd].playoffs,
		},
		lost: {
			...game.lost,
			region: game.teams[lostInd].region,
			name: game.teams[lostInd].name,
			abbrev: game.teams[lostInd].abbrev,
			imgURL: game.teams[lostInd].imgURL,
			won: game.teams[lostInd].won,
			lost: game.teams[lostInd].lost,
			tied: game.teams[lostInd].tied,
			otl: game.teams[lostInd].otl,
			playoffs: game.teams[lostInd].playoffs,
		},
	};

	// Swap teams order, so home team is at bottom in box score
	game2.teams.reverse();

	if (game2.scoringSummary) {
		for (const event of game2.scoringSummary) {
			event.t = event.t === 0 ? 1 : 0;
		}
	}

	return game2;
};

const updateTeamSeason = async (inputs: ViewInput<"gameLog">) => {
	return {
		// Needed for dropdown
		abbrev: inputs.abbrev,
		currentSeason: g.get("season"),
		season: inputs.season,
		tid: inputs.tid,
	};
};

/**
 * Update the displayed box score, as necessary.
 *
 * If the box score is already loaded, nothing is done.
 *
 * @memberOf views.gameLog
 * @param {number} inputs.gid Integer game ID for the box score (a negative number means no box score).
 */
const updateBoxScore = async (
	{ gid }: ViewInput<"gameLog">,
	updateEvents: UpdateEvents,
	state: any,
) => {
	if (
		updateEvents.includes("firstRun") ||
		!state.boxScore ||
		gid !== state.boxScore.gid
	) {
		const game = await boxScore(gid);
		return { boxScore: game };
	}
};

export const loadAbbrevs = async (season: number) => {
	const abbrevs: Record<number, string> = {};
	abbrevs[-2] = "ASG";
	abbrevs[-1] = "ASG";

	let loaded = false;

	// For historical seasons, look up old abbrevs
	if (g.get("season") !== season || g.get("phase") >= PHASE.PLAYOFFS) {
		const teamSeasons = await idb.getCopies.teamSeasons({
			season,
		});
		if (teamSeasons.length > 0) {
			for (const row of teamSeasons) {
				abbrevs[row.tid] = row.abbrev;
			}
			loaded = true;
		}
	}

	// If no old abbrevs found, or if this is the current season, use cache
	if (!loaded) {
		const teamInfoCache = g.get("teamInfoCache");
		for (const [tid, t] of teamInfoCache.entries()) {
			abbrevs[tid] = t.abbrev;
		}
	}

	return abbrevs;
};

/**
 * Update the game log list, as necessary.
 *
 * If the game log list is already loaded, nothing is done. If the game log list is loaded and a new game has been played, update. If the game log list is not loaded, load it.
 *
 * @memberOf views.gameLog
 * @param {string} inputs.abbrev Abbrev of the team for the list of games.
 * @param {number} inputs.season Season for the list of games.
 * @param {number} inputs.gid Integer game ID for the box score (a negative number means no box score), which is used only for highlighting the relevant entry in the list.
 */
const updateGamesList = async (
	{ season, tid }: ViewInput<"gameLog">,
	updateEvents: UpdateEvents,
	{
		gamesList,
	}: {
		gamesList?: {
			abbrevs: Record<number, string>;
			games: Game[];
			tid: number;
			season: number;
		};
	},
) => {
	if (
		updateEvents.includes("firstRun") ||
		!gamesList ||
		tid !== gamesList.tid ||
		season !== gamesList.season ||
		(updateEvents.includes("gameSim") && season === g.get("season"))
	) {
		let games: Game[];
		let abbrevs: Record<number, string>;

		if (gamesList && (tid !== gamesList.tid || season !== gamesList.season)) {
			// Switching to a new list
			games = [];
		} else {
			games = gamesList ? gamesList.games : [];
		}

		if (!gamesList || season !== gamesList.season) {
			// Load abbrevs for this season
			abbrevs = await loadAbbrevs(season);
		} else {
			abbrevs = gamesList.abbrevs;
		}

		const newGames = await getProcessedGames({
			tid,
			season,
			loadedGames: games,
		});

		if (games.length === 0) {
			games = newGames;
		} else {
			for (let i = newGames.length - 1; i >= 0; i--) {
				games.unshift(newGames[i]!);
			}
		}

		return {
			gamesList: {
				abbrevs,
				games,
				tid,
				season,
			},
		};
	}
};

export default async (
	inputs: ViewInput<"gameLog">,
	updateEvents: UpdateEvents,
	state: any,
) => {
	return Object.assign(
		{},
		await updateBoxScore(inputs, updateEvents, state),
		await updateGamesList(inputs, updateEvents, state),
		await updateTeamSeason(inputs),
	);
};
