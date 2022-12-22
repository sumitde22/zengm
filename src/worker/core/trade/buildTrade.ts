import type { DataPoint, Result } from "regression";
import { groupBy } from "../../../common/groupBy";
import type {
	DraftPick,
	MinimalPlayerRatings,
	Player,
	Team,
	TradePickValues,
	TradeTeams,
} from "src/common/types";
import { g, helpers, local } from "../../util";
import { idb } from "../../db";
import draft from "../draft";
import team from "../team";
import trade from ".";
import regression from "regression";
import { getContractValue, zscore, EXPONENT } from "../team/valueChange";
import { getNumPicksPerRound } from "./getPickValues";
import { PHASE } from "../../../common";

// updated once per season
let cache: {
	cacheKey: number;
	// an equation to map from a team ovr to an ovr rank among league
	// changed at the beginning of each season so it accurate models the distribution of the present league
	ovrToRankModel: Result;
	estValues: TradePickValues;
	rookieSalaries: number[];
};

type Asset = {
	id: number;
	proposingTeamValue: number;
	receivingTeamValue: number;
};

type TradeEvaluationInfo = {
	team: Team;
	// TODO: see if using sets/dictionaries speeds things up
	allPlayers: Player<MinimalPlayerRatings>[];
	allPicks: DraftPick[];
	playersInTrade: Asset[];
	playersNotInTrade: Asset[];
	// index 0 represents teams[0]'s evaluation, index[1] represent teams[1]'s evaluation of asset
	playerValueGivingUp: [number, number];
	draftPicksInTrade: Asset[];
	draftPicksNotInTrade: Asset[];
	draftPickValueGivingUp: [number, number];
};

let tradeEvaluationCache: [
	// teams[0] assets
	TradeEvaluationInfo,
	// teams[1] assets
	TradeEvaluationInfo,
];

const initializeTradeEvaluationCache = async (teams: TradeTeams) => {
	const t = await idb.cache.teams.get(teams[0].tid);
	const t2 = await idb.cache.teams.get(teams[1].tid);
	const t1Players = await idb.cache.players.indexGetAll(
		"playersByTid",
		teams[0].tid,
	);
	const t2Players = await idb.cache.players.indexGetAll(
		"playersByTid",
		teams[1].tid,
	);
	const t1Picks = await idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		teams[0].tid,
	);
	const t2Picks = await idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		teams[1].tid,
	);
	tradeEvaluationCache = [
		{
			team: t!,
			allPlayers: t1Players,
			allPicks: t1Picks,
			playersInTrade: [],
			playersNotInTrade: [],
			playerValueGivingUp: [0, 0],
			draftPicksInTrade: [],
			draftPicksNotInTrade: [],
			draftPickValueGivingUp: [0, 0],
		},
		{
			team: t2!,
			allPlayers: t2Players,
			allPicks: t2Picks,
			playersInTrade: [],
			playersNotInTrade: [],
			playerValueGivingUp: [0, 0],
			draftPicksInTrade: [],
			draftPicksNotInTrade: [],
			draftPickValueGivingUp: [0, 0],
		},
	];
	for (const i of [0, 1]) {
		// apparently foreach doesn't work well with promises so using for loop instead
		for (const pid of teams[i].pids) {
			const value = getPlayerTradeValue(
				tradeEvaluationCache[i].allPlayers[pid],
				tradeEvaluationCache[1].team.strategy,
				teams[1].tid,
				teams[0].tid,
			);
			tradeEvaluationCache[i].playersInTrade.push({
				id: pid,
				proposingTeamValue: 0,
				receivingTeamValue: value,
			});
			tradeEvaluationCache[i].playerValueGivingUp[1] =
				tradeEvaluationCache[i].playerValueGivingUp[1] + value;
		}
		for (const dpid of teams[i].dpids) {
			const value = await getPickTradeValue(
				tradeEvaluationCache[i].allPicks[dpid],
				tradeEvaluationCache[0].team.strategy,
				teams[0].tid,
			);
			tradeEvaluationCache[i].draftPicksInTrade.push({
				id: dpid,
				proposingTeamValue: 0,
				receivingTeamValue: value,
			});
			tradeEvaluationCache[i].draftPickValueGivingUp[1] =
				tradeEvaluationCache[i].draftPickValueGivingUp[1] + value;
		}
	}
};

const refreshCache = async () => {
	const season = g.get("season");
	if (cache === undefined || cache.cacheKey != season) {
		const playersByTid = groupBy(
			await idb.cache.players.indexGetAll("playersByTid", [0, Infinity]),
			"tid",
		);

		const teamOvrs: {
			tid: number;
			ovr: number;
		}[] = [];
		for (const [tidString, players] of Object.entries(playersByTid)) {
			const tid = parseInt(tidString);
			const ovr = team.ovr(
				players.map(p => ({
					pid: p.pid,
					value: p.value,
					ratings: {
						ovr: p.ratings.at(-1)!.ovr,
						ovrs: p.ratings.at(-1)!.ovrs,
						pos: p.ratings.at(-1)!.pos,
					},
				})),
				{
					fast: true,
				},
			);

			teamOvrs.push({ tid, ovr });
		}

		teamOvrs.sort((a, b) => b.ovr - a.ovr);

		const teamRanks: DataPoint[] = teamOvrs.map((team, index) => [
			team.ovr,
			index + 1,
		]);
		// generate a function using linear regression that maps team ovr -> estimated team rank
		const ovrToRankModel = regression.linear(teamRanks);

		cache = {
			cacheKey: season,
			ovrToRankModel,
			rookieSalaries: draft.getRookieSalaries(),
			estValues: await trade.getPickValues(),
		};
	}
};

const buildTrade = async (
	teams: TradeTeams,
	holdUserConstant: boolean,
	maxAssetsToAdd = Infinity,
): Promise<TradeTeams | undefined> => {
	await refreshCache();
	await initializeTradeEvaluationCache(teams);
	// rough draft:
	// 1. Eval players/picks from "receiving team", teams[1] perspective
	//    a) if favorable to "proposing teams", proceed to step 2
	//    b) else proceed to step 3
	// 2. Add assets from "proposing team" until total value given by proposing team > receiving team
	//      - Also take into account maxAssetsToAdd
	// 3. Keep adding most valuable assets from "proposing team", ensure trade still favorable to "receiving" team
	//      -- Also take into account negative receiving team assets, holdUserConstant, maxAssetsToAdd

	// invariant: user team/proposing team will always be teams[0]
	console.log(JSON.stringify(tradeEvaluationCache));
	return;
};

// add assets from trade proposer until assets given by proposer value > assets given by receiver
// using forward selection, always add asset that will push the trade value the smallest amount above 0
// and biggest asset otherwise if said asset doesn't exist
const addProposerAssets = async (
	teams: TradeTeams,
	holdUserConstant: boolean,
	maxAssetsToAdd = Infinity,
): Promise<TradeTeams | undefined> => {
	return;
};

// add assets from trade receiver to miminize positive value of (proposer giving assets value - receiver giving assets value)
// using forward selection, add biggest asset that does not cause receiver assets value > proposer assets value
const addReceiverAssets = async (
	teams: TradeTeams,
	holdUserConstant: boolean,
	maxAssetsToAdd = Infinity,
) => {};

const getPlayerTradeValue = (
	player: Player<MinimalPlayerRatings>,
	teamStrategy: string,
	tid: number,
	tradingPartnerTid: number,
) => {
	const difficultyFudgeFactor = helpers.bound(
		1 + 0.1 * g.get("difficulty"),
		0,
		Infinity,
	); // 2.5% bonus for easy, 2.5% penalty for hard, 10% penalty for insane

	// Fudge factor for AI overvaluing its own players
	const fudgeFactor =
		(tid !== g.get("userTid") && tradingPartnerTid !== g.get("userTid")
			? 1.05
			: 1) * difficultyFudgeFactor;

	// note: player.value initially calculated in updateValues
	let value = zscore(player.value);
	if (player.tid === tid && value > 0) {
		value *= fudgeFactor;
	}

	const age = g.get("season") - player.born.year;
	// could this be converted to an equation? prob wouldn't change speed but would reduce lines of code lol
	if (teamStrategy === "rebuilding") {
		if (age <= 19) {
			value *= 1.075;
		} else if (age === 20) {
			value *= 1.05;
		} else if (age === 21) {
			value *= 1.0375;
		} else if (age === 22) {
			value *= 1.025;
		} else if (age === 23) {
			value *= 1.0125;
		} else if (age === 27) {
			value *= 0.975;
		} else if (age === 28) {
			value *= 0.95;
		} else if (age >= 29) {
			value *= 0.9;
		}
	} else {
		if (age <= 19) {
			value *= 0.8;
		} else if (age === 20) {
			value *= 0.825;
		} else if (age === 21) {
			value *= 0.85;
		} else if (age === 22) {
			value *= 0.875;
		} else if (age === 23) {
			value *= 0.925;
		} else if (age === 24) {
			value *= 0.95;
		}
	}

	// Normalize for injuries
	// Injury penalty is applied if its a player from the user team being traded to an AI team
	if (player.tid === tradingPartnerTid) {
		if (player.injury.gamesRemaining > 75) {
			value -= value * 0.75;
		} else {
			value -= (value * player.injury.gamesRemaining) / 100;
		}
	}

	// Really bad players will just get no PT
	if (value < 0) {
		value = 0;
	}

	const contractsFactor = teamStrategy === "rebuilding" ? 2 : 0.5;
	value +=
		contractsFactor * getContractValue(player.contract, zscore(player.value));
	// console.log(playerValue, p);

	// if a player was just drafted and can be released, they shouldn't have negative value
	if (
		helpers.justDrafted(
			{ draft: { year: player.draft.year }, contract: player.contract },
			g.get("phase"),
			g.get("season"),
		)
	) {
		value = Math.max(0, value);
	}

	value = value > 1 ? value ** EXPONENT : value;

	console.log(`NEW value ${player.lastName}: ${value}`);

	return value;
};

const getPickTradeValue = async (
	dp: DraftPick,
	strategy: string,
	tradingPartnerTid: number,
) => {
	const numPicksPerRound = getNumPicksPerRound();
	const season =
		dp.season === "fantasy" || dp.season === "expansion"
			? g.get("season")
			: dp.season;
	let estPick: number;
	if (dp.pick > 0) {
		estPick = dp.pick;
	} else {
		estPick = await getEstimatedPick(dp.originalTid);
		// tid rather than originalTid, because it's about what the user can control
		const usersPick = dp.tid === g.get("userTid");

		// Used to know when to overvalue own pick
		const tradeWithUser = tradingPartnerTid === g.get("userTid");

		// For future draft picks, add some uncertainty.
		const regressionTarget = (usersPick ? 0.75 : 0.25) * numPicksPerRound;

		// Never let this improve the future projection of user's picks
		let seasons = helpers.bound(season - g.get("season"), 0, 5);
		if (tradeWithUser && seasons > 0) {
			// When trading with the user, expect things to change rapidly
			seasons = helpers.bound(seasons + 1, 0, 5);
		}

		if (seasons === 0 && g.get("phase") < PHASE.PLAYOFFS) {
			// Would be better to base on fraction of season completed, but oh well
			seasons += 0.5;
		}

		// Weighted average of estPicks and regressionTarget
		estPick = Math.round(
			(estPick * (5 - seasons)) / 5 + (regressionTarget * seasons) / 5,
		);

		if (tradeWithUser && seasons > 0) {
			if (usersPick) {
				// Penalty for user draft picks
				const difficultyFactor = 1 + 1.5 * g.get("difficulty");
				estPick = helpers.bound(
					Math.round((estPick + numPicksPerRound / 3.5) * difficultyFactor),
					1,
					numPicksPerRound,
				);
			} else {
				// Bonus for AI draft picks
				estPick = helpers.bound(
					Math.round(estPick - numPicksPerRound / 3.5),
					1,
					numPicksPerRound,
				);
			}
		}
	}

	estPick += numPicksPerRound * (dp.round - 1);

	let value;
	const valuesTemp = cache.estValues[season];
	if (valuesTemp) {
		value = valuesTemp[estPick - 1];
	}
	if (value === undefined) {
		value = cache.estValues.default[estPick - 1];
	}
	if (value === undefined) {
		value = cache.estValues.default.at(-1);
	}
	if (value === undefined) {
		value = 20;
	}

	value = zscore(value);

	let contractValue = getContractValue(
		{
			amount: cache.rookieSalaries[estPick - 1],
			exp: season + 2,
		},
		value,
	);

	// Since rookies can be cut after the draft, value of a draft pick can't be negative
	value = Math.max(0.1, value);
	contractValue = Math.max(0, contractValue);

	// Ensure there are no tied pick values
	value -= estPick * 1e-10;

	const treatAsFutureDraftPick =
		season !== g.get("season") || g.get("phase") <= PHASE.PLAYOFFS;

	if (treatAsFutureDraftPick) {
		if (strategy === "rebuilding") {
			// Value young/cheap players and draft picks more. Penalize expensive/old players
			value *= 1.1;
		} else {
			// Much of the value for these players comes from potential, which we don't really care about
			value *= 0.825;
		}
	}

	const contractsFactor = strategy === "rebuilding" ? 2 : 0.5;
	value += contractsFactor * contractValue;

	value = value > 1 ? value ** EXPONENT : value;

	return value;
};

const getEstimatedPick = async (tid: number) => {
	// TODO: dynamically get traded players from trade, also make copies somewhere here
	let players: Player<MinimalPlayerRatings>[];
	if (tid === tradeEvaluationCache[0].team.tid) {
		players = tradeEvaluationCache[0].allPlayers;
	} else if (tid === tradeEvaluationCache[1].team.tid) {
		players = tradeEvaluationCache[1].allPlayers;
	} else {
		players = await idb.cache.players.indexGetAll("playersByTid", tid);
	}

	const playerRatings = players.map(p => ({
		pid: p.pid,
		value: p.value,
		ratings: {
			ovr: p.ratings.at(-1)!.ovr,
			ovrs: p.ratings.at(-1)!.ovrs,
			pos: p.ratings.at(-1)!.pos,
		},
	}));

	const teamOvr = team.ovr(playerRatings, { fast: true });

	const teamOvrRank = cache.ovrToRankModel.predict(teamOvr)[1];

	const teamOvrWinp =
		0.25 +
		(0.5 * (g.get("numActiveTeams") - 1 - teamOvrRank)) /
			(g.get("numActiveTeams") - 1);

	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, g.get("season")],
	);

	let record: [number, number];

	if (teamSeason === undefined) {
		// Expansion team?
		record = [0, 0];
	} else {
		record = [teamSeason.won, teamSeason.lost];
	}

	const gp = record[0] + record[1];
	let projectedWinP: number;

	if (gp === 0) {
		projectedWinP = teamOvrWinp;
	} else {
		const seasonFraction = gp / g.get("numGames");
		projectedWinP =
			seasonFraction * (record[0] / gp) + (1 - seasonFraction) * teamOvrWinp;
	}

	return winPToPick(projectedWinP);
};

// Source: https://stackoverflow.com/questions/55725139/fit-sigmoid-function-s-shape-curve-to-data-using-python
// This curve models specifically a mapping from win % to estimated draft pick based on simulation of 30 BBGM seasons
// Different curves could be generated for other sports as well, and the parameters below could be decided based on sport
const winPToPick = (winP: number) => {
	const L = 1.0687820005007198;
	const x0 = 0.4878517508315021;
	const k = 10.626956987806935;
	const b = -0.038756647038824504;
	// without multiplying numActiveTeams, the equation returns a val
	// representing position in draft as a decimal between 0 to 1
	// numDraftsPickPerRound scales this equation so it ports across leagues with different numbers of team
	const numDraftPicksPerRound = getNumPicksPerRound();
	const projectedPick =
		numDraftPicksPerRound * (L / (1 + Math.exp(-k * (winP - x0))) + b);
	return helpers.bound(projectedPick, 1, numDraftPicksPerRound);
};

export default buildTrade;
