import genRatings from "./genRatings.ts";
import { face, g } from "../../util/index.ts";
import type {
	MinimalPlayerRatings,
	NonEmptyArray,
	PlayerWithoutKey,
	Race,
} from "../../../common/types.ts";
import genWeight from "./genWeight.ts";
import genMoodTraits from "./genMoodTraits.ts";

const generate = (
	tid: number,
	age: number,
	draftYear: number,
	newLeague: boolean,
	scoutingLevel: number,
	{
		college,
		country,
		firstName,
		lastName,
		race,
	}: {
		college: string;
		country: string;
		firstName: string;
		lastName: string;
		race: Race;
	} = {
		college: "College",
		country: "Country",
		firstName: "FirstName",
		lastName: "LastName",
		race: "asian",
	},
): PlayerWithoutKey<MinimalPlayerRatings> => {
	const { heightInInches, ratings } = genRatings(
		newLeague ? g.get("startingSeason") : draftYear,
		scoutingLevel,
	);
	// lastName += `-${genPos}`;

	const weight = genWeight(ratings.hgt, (ratings as any).stre);

	let actualHeightInInches = g.get("heightFactor") * heightInInches;
	if (g.get("gender") === "female") {
		// Ratio comes from average USA stats
		actualHeightInInches *= 0.92;
	}
	actualHeightInInches = Math.round(actualHeightInInches);

	const ratingsArray: NonEmptyArray<MinimalPlayerRatings> = [ratings];

	const p = {
		awards: [],
		born: {
			year: g.get("season") - age,
			loc: country,
		},
		college,
		contract: {
			amount: g.get("minContract"),
			exp: g.get("season") + 1,
		},
		draft: {
			round: 0,
			pick: 0,
			tid: -1,
			originalTid: -1,
			year: draftYear,
			pot: 0,
			ovr: 0,
			skills: [],
		},
		face: face.generate({ race }),
		firstName,
		gamesUntilTradable: 0,
		hgt: actualHeightInInches,
		imgURL: "",
		injury: {
			type: "Healthy",
			gamesRemaining: 0,
		},
		injuries: [],
		lastName,
		moodTraits: genMoodTraits(),
		numDaysFreeAgent: 0,
		ptModifier: 1,
		relatives: [],
		ratings: ratingsArray,
		retiredYear: Infinity,
		rosterOrder: 666, // Will be set later
		salaries: [],
		stats: [],
		statsTids: [],
		tid,
		transactions: [],
		weight,
		yearsFreeAgent: 0,

		// These should be set by updateValues after player is completely done (automatic in develop)
		value: 0,
		valueNoPot: 0,
		valueFuzz: 0,
		valueNoPotFuzz: 0,
	};

	return p;
};

export default generate;
