import { defaultInjuries, defaultTragicDeaths, g } from "../util/index.ts";
import type {
	GameAttributesLeague,
	GetLeagueOptionsReal,
	InjuriesSetting,
	TragicDeaths,
	UpdateEvents,
} from "../../common/types.ts";
import goatFormula from "../util/goatFormula.ts";

type Key =
	| "godMode"
	| "godModeInPast"
	| "numGames"
	| "numGamesDiv"
	| "numGamesConf"
	| "numActiveTeams"
	| "quarterLength"
	| "maxRosterSize"
	| "minRosterSize"
	| "salaryCap"
	| "minPayroll"
	| "luxuryPayroll"
	| "luxuryTax"
	| "minContract"
	| "maxContract"
	| "minContractLength"
	| "maxContractLength"
	| "aiTradesFactor"
	| "injuryRate"
	| "homeCourtAdvantage"
	| "rookieContractLengths"
	| "rookiesCanRefuse"
	| "tragicDeathRate"
	| "brotherRate"
	| "sonRate"
	| "forceRetireAge"
	| "forceRetireSeasons"
	| "salaryCapType"
	| "numGamesPlayoffSeries"
	| "numPlayoffByes"
	| "draftType"
	| "draftAges"
	| "playersRefuseToNegotiate"
	| "allStarGame"
	| "allStarNum"
	| "allStarType"
	| "budget"
	| "numSeasonsFutureDraftPicks"
	| "foulRateFactor"
	| "foulsNeededToFoulOut"
	| "foulsUntilBonus"
	| "threePointers"
	| "pace"
	| "threePointTendencyFactor"
	| "threePointAccuracyFactor"
	| "twoPointAccuracyFactor"
	| "ftAccuracyFactor"
	| "blockFactor"
	| "stealFactor"
	| "turnoverFactor"
	| "orbFactor"
	| "challengeNoDraftPicks"
	| "challengeNoFreeAgents"
	| "challengeNoTrades"
	| "challengeLoseBestPlayer"
	| "challengeNoRatings"
	| "challengeFiredLuxuryTax"
	| "challengeFiredMissPlayoffs"
	| "challengeSisyphusMode"
	| "challengeThanosMode"
	| "realPlayerDeterminism"
	| "repeatSeason"
	| "maxOvertimes"
	| "maxOvertimesPlayoffs"
	| "shootoutRounds"
	| "shootoutRoundsPlayoffs"
	| "otl"
	| "spectator"
	| "elam"
	| "elamASG"
	| "elamMinutes"
	| "elamOvertime"
	| "elamPoints"
	| "playerMoodTraits"
	| "numPlayersOnCourt"
	| "numDraftRounds"
	| "tradeDeadline"
	| "difficulty"
	| "stopOnInjury"
	| "stopOnInjuryGames"
	| "aiJerseyRetirement"
	| "numPeriods"
	| "tiebreakers"
	| "pointsFormula"
	| "equalizeRegions"
	| "realDraftRatings"
	| "hideDisabledTeams"
	| "hideProgressions"
	| "hofFactor"
	| "injuries"
	| "inflationAvg"
	| "inflationMax"
	| "inflationMin"
	| "inflationStd"
	| "playoffsByConf"
	| "playoffsNumTeamsDiv"
	| "playoffsReseed"
	| "playerBioInfo"
	| "playIn"
	| "numPlayersDunk"
	| "numPlayersThree"
	| "fantasyPoints"
	| "goatFormula"
	| "goatSeasonFormula"
	| "draftPickAutoContract"
	| "draftPickAutoContractPercent"
	| "draftPickAutoContractRounds"
	| "dh"
	| "draftLotteryCustomNumPicks"
	| "draftLotteryCustomChances"
	| "passFactor"
	| "rushYdsFactor"
	| "passYdsFactor"
	| "completionFactor"
	| "scrambleFactor"
	| "sackFactor"
	| "fumbleFactor"
	| "intFactor"
	| "fgAccuracyFactor"
	| "fourthDownFactor"
	| "onsideFactor"
	| "onsideRecoveryFactor"
	| "hitFactor"
	| "giveawayFactor"
	| "takeawayFactor"
	| "deflectionFactor"
	| "saveFactor"
	| "assistFactor"
	| "foulFactor"
	| "groundFactor"
	| "lineFactor"
	| "flyFactor"
	| "powerFactor"
	| "throwOutFactor"
	| "strikeFactor"
	| "balkFactor"
	| "wildPitchFactor"
	| "passedBallFactor"
	| "hitByPitchFactor"
	| "swingFactor"
	| "contactFactor"
	| "softCapTradeSalaryMatch"
	| "gender"
	| "heightFactor"
	| "weightFactor"
	| "allStarDunk"
	| "allStarThree"
	| "minRetireAge"
	| "numWatchColors"
	| "giveMeWorstRoster"
	| "groupScheduleSeries"
	| "autoExpandProb"
	| "autoExpandNumTeams"
	| "autoExpandMaxNumTeams"
	| "autoExpandGeo"
	| "autoRelocateProb"
	| "autoRelocateGeo"
	| "autoRelocateRealign"
	| "autoRelocateRebrand"
	| "alwaysShowCountry"
	| "neutralSite"
	| "rpdPot"
	| "saveOldBoxScores"
	| "currencyFormat";

export type Settings = Pick<
	GameAttributesLeague,
	Exclude<
		Key,
		| "repeatSeason"
		| "realDraftRatings"
		| "injuries"
		| "tragicDeaths"
		| "goatFormula"
		| "numActiveTeams"
		| "giveMeWorstRoster"
	>
> & {
	repeatSeason:
		| NonNullable<GameAttributesLeague["repeatSeason"]>["type"]
		| "disabled";
	noStartingInjuries: boolean;
	realDraftRatings: Exclude<
		GameAttributesLeague["realDraftRatings"],
		undefined
	>;
	randomization:
		| "none"
		| "shuffle"
		| "debuts"
		| "debutsKeepCurrent"
		| "debutsForever"
		| "debutsForeverKeepCurrent";
	realStats: GetLeagueOptionsReal["realStats"];
	injuries: InjuriesSetting;
	tragicDeaths: TragicDeaths;
	goatFormula: string;
	goatSeasonFormula: string;
	confs?: GameAttributesLeague["confs"];
	giveMeWorstRoster: boolean;

	// undefined in DefaultNewLeagueSettings - then it is not possible to validate some settings that depend on it
	numActiveTeams: number | undefined;
};

const updateSettings = async (inputs: unknown, updateEvents: UpdateEvents) => {
	if (
		updateEvents.includes("firstRun") ||
		updateEvents.includes("gameAttributes")
	) {
		const initialSettings: Settings = {
			godMode: g.get("godMode"),
			godModeInPast: g.get("godModeInPast"),
			numGames: g.get("numGames"),
			numGamesDiv: g.get("numGamesDiv"),
			numGamesConf: g.get("numGamesConf"),
			numActiveTeams: g.get("numActiveTeams"),
			quarterLength: g.get("quarterLength"),
			maxRosterSize: g.get("maxRosterSize"),
			minRosterSize: g.get("minRosterSize"),
			salaryCap: g.get("salaryCap"),
			minPayroll: g.get("minPayroll"),
			luxuryPayroll: g.get("luxuryPayroll"),
			luxuryTax: g.get("luxuryTax"),
			minContract: g.get("minContract"),
			maxContract: g.get("maxContract"),
			minContractLength: g.get("minContractLength"),
			maxContractLength: g.get("maxContractLength"),
			aiTradesFactor: g.get("aiTradesFactor"),
			injuryRate: g.get("injuryRate"),
			homeCourtAdvantage: g.get("homeCourtAdvantage"),
			rookieContractLengths: g.get("rookieContractLengths"),
			rookiesCanRefuse: g.get("rookiesCanRefuse"),
			tragicDeathRate: g.get("tragicDeathRate"),
			brotherRate: g.get("brotherRate"),
			sonRate: g.get("sonRate"),
			forceRetireAge: g.get("forceRetireAge"),
			forceRetireSeasons: g.get("forceRetireSeasons"),
			salaryCapType: g.get("salaryCapType"),
			numGamesPlayoffSeries: g.get("numGamesPlayoffSeries"),
			numPlayoffByes: g.get("numPlayoffByes"),
			draftType: g.get("draftType"),
			draftAges: g.get("draftAges"),
			playersRefuseToNegotiate: g.get("playersRefuseToNegotiate"),
			allStarGame: g.get("allStarGame"),
			allStarNum: g.get("allStarNum"),
			allStarType: g.get("allStarType"),
			budget: g.get("budget"),
			numSeasonsFutureDraftPicks: g.get("numSeasonsFutureDraftPicks"),
			foulRateFactor: g.get("foulRateFactor"),
			foulsNeededToFoulOut: g.get("foulsNeededToFoulOut"),
			foulsUntilBonus: g.get("foulsUntilBonus"),
			threePointers: g.get("threePointers"),
			pace: g.get("pace"),
			threePointTendencyFactor: g.get("threePointTendencyFactor"),
			threePointAccuracyFactor: g.get("threePointAccuracyFactor"),
			twoPointAccuracyFactor: g.get("twoPointAccuracyFactor"),
			ftAccuracyFactor: g.get("ftAccuracyFactor"),
			blockFactor: g.get("blockFactor"),
			stealFactor: g.get("stealFactor"),
			turnoverFactor: g.get("turnoverFactor"),
			orbFactor: g.get("orbFactor"),
			challengeNoDraftPicks: g.get("challengeNoDraftPicks"),
			challengeNoFreeAgents: g.get("challengeNoFreeAgents"),
			challengeNoTrades: g.get("challengeNoTrades"),
			challengeLoseBestPlayer: g.get("challengeLoseBestPlayer"),
			challengeNoRatings: g.get("challengeNoRatings"),
			challengeFiredLuxuryTax: g.get("challengeFiredLuxuryTax"),
			challengeFiredMissPlayoffs: g.get("challengeFiredMissPlayoffs"),
			challengeSisyphusMode: g.get("challengeSisyphusMode"),
			challengeThanosMode: g.get("challengeThanosMode"),
			realPlayerDeterminism: g.get("realPlayerDeterminism"),
			repeatSeason: g.get("repeatSeason")?.type ?? "disabled",
			maxOvertimes: g.get("maxOvertimes"),
			maxOvertimesPlayoffs: g.get("maxOvertimesPlayoffs"),
			shootoutRounds: g.get("shootoutRounds"),
			shootoutRoundsPlayoffs: g.get("shootoutRoundsPlayoffs"),
			otl: g.get("otl"),
			spectator: g.get("spectator"),
			elam: g.get("elam"),
			elamASG: g.get("elamASG"),
			elamMinutes: g.get("elamMinutes"),
			elamOvertime: g.get("elamOvertime"),
			elamPoints: g.get("elamPoints"),
			playerMoodTraits: g.get("playerMoodTraits"),
			numPlayersOnCourt: g.get("numPlayersOnCourt"),
			numDraftRounds: g.get("numDraftRounds"),
			tradeDeadline: g.get("tradeDeadline"),
			difficulty: g.get("difficulty"),
			stopOnInjury: g.get("stopOnInjury"),
			stopOnInjuryGames: g.get("stopOnInjuryGames"),
			aiJerseyRetirement: g.get("aiJerseyRetirement"),
			numPeriods: g.get("numPeriods"),
			tiebreakers: g.get("tiebreakers"),
			pointsFormula: g.get("pointsFormula"),
			equalizeRegions: g.get("equalizeRegions"),
			hideDisabledTeams: g.get("hideDisabledTeams"),
			hideProgressions: g.get("hideProgressions"),
			noStartingInjuries: false,
			hofFactor: g.get("hofFactor"),
			injuries: g.get("injuries") ?? defaultInjuries,
			inflationAvg: g.get("inflationAvg"),
			inflationMax: g.get("inflationMax"),
			inflationMin: g.get("inflationMin"),
			inflationStd: g.get("inflationStd"),
			playoffsByConf: g.get("playoffsByConf"),
			playoffsNumTeamsDiv: g.get("playoffsNumTeamsDiv"),
			playoffsReseed: g.get("playoffsReseed"),
			playerBioInfo: g.get("playerBioInfo"),
			playIn: g.get("playIn"),
			confs: g.get("confs"),
			numPlayersDunk: g.get("numPlayersDunk"),
			numPlayersThree: g.get("numPlayersThree"),
			fantasyPoints: g.get("fantasyPoints"),
			tragicDeaths: g.get("tragicDeaths") ?? defaultTragicDeaths,
			goatFormula: g.get("goatFormula") ?? goatFormula.DEFAULT_FORMULA,
			goatSeasonFormula:
				g.get("goatSeasonFormula") ?? goatFormula.DEFAULT_FORMULA_SEASON,
			draftPickAutoContract: g.get("draftPickAutoContract"),
			draftPickAutoContractPercent: g.get("draftPickAutoContractPercent"),
			draftPickAutoContractRounds: g.get("draftPickAutoContractRounds"),
			dh: g.get("dh"),
			draftLotteryCustomNumPicks: g.get("draftLotteryCustomNumPicks"),
			draftLotteryCustomChances: g.get("draftLotteryCustomChances"),
			passFactor: g.get("passFactor"),
			rushYdsFactor: g.get("rushYdsFactor"),
			passYdsFactor: g.get("passYdsFactor"),
			completionFactor: g.get("completionFactor"),
			scrambleFactor: g.get("scrambleFactor"),
			sackFactor: g.get("sackFactor"),
			fumbleFactor: g.get("fumbleFactor"),
			intFactor: g.get("intFactor"),
			fgAccuracyFactor: g.get("fgAccuracyFactor"),
			fourthDownFactor: g.get("fourthDownFactor"),
			onsideFactor: g.get("onsideFactor"),
			onsideRecoveryFactor: g.get("onsideRecoveryFactor"),
			hitFactor: g.get("hitFactor"),
			giveawayFactor: g.get("giveawayFactor"),
			takeawayFactor: g.get("takeawayFactor"),
			deflectionFactor: g.get("deflectionFactor"),
			saveFactor: g.get("saveFactor"),
			assistFactor: g.get("assistFactor"),
			foulFactor: g.get("foulFactor"),
			groundFactor: g.get("groundFactor"),
			lineFactor: g.get("lineFactor"),
			flyFactor: g.get("flyFactor"),
			powerFactor: g.get("powerFactor"),
			throwOutFactor: g.get("throwOutFactor"),
			strikeFactor: g.get("strikeFactor"),
			balkFactor: g.get("balkFactor"),
			wildPitchFactor: g.get("wildPitchFactor"),
			passedBallFactor: g.get("passedBallFactor"),
			hitByPitchFactor: g.get("hitByPitchFactor"),
			swingFactor: g.get("swingFactor"),
			contactFactor: g.get("contactFactor"),
			softCapTradeSalaryMatch: g.get("softCapTradeSalaryMatch"),
			gender: g.get("gender"),
			heightFactor: g.get("heightFactor"),
			weightFactor: g.get("weightFactor"),
			allStarDunk: g.get("allStarDunk"),
			allStarThree: g.get("allStarThree"),
			minRetireAge: g.get("minRetireAge"),
			numWatchColors: g.get("numWatchColors"),
			groupScheduleSeries: g.get("groupScheduleSeries"),
			autoExpandProb: g.get("autoExpandProb"),
			autoExpandNumTeams: g.get("autoExpandNumTeams"),
			autoExpandMaxNumTeams: g.get("autoExpandMaxNumTeams"),
			autoExpandGeo: g.get("autoExpandGeo"),
			autoRelocateProb: g.get("autoRelocateProb"),
			autoRelocateGeo: g.get("autoRelocateGeo"),
			autoRelocateRealign: g.get("autoRelocateRealign"),
			autoRelocateRebrand: g.get("autoRelocateRebrand"),
			alwaysShowCountry: g.get("alwaysShowCountry"),
			neutralSite: g.get("neutralSite"),
			rpdPot: g.get("rpdPot"),
			saveOldBoxScores: g.get("saveOldBoxScores"),
			currencyFormat: g.get("currencyFormat"),

			// Might as well be undefined, because it will never be saved from this form, only the new league form
			realDraftRatings: g.get("realDraftRatings") ?? "rookie",
			randomization: "none",
			realStats: "none",
			giveMeWorstRoster: false,
		};

		return {
			initialSettings,
		};
	}
};

export default updateSettings;
