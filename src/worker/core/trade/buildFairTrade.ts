import type { Result } from "regression";
import type { TradePickValues } from "src/common/types";

let cache: {
	cacheKey: number;
	ovrToRankModel: Result;
	estValues: TradePickValues;
};

const refreshCache = () => {
	if (cache === undefined) {
	}
};

const buildFairTrade = () => {
	refreshCache();
};

export default buildFairTrade;
