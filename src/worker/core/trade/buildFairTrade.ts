import type { Result } from "regression";
import type { TradePickValues } from "src/common/types";
import { g, helpers, local } from "../../util";

let cache: {
	cacheKey: number;
	ovrToRankModel: Result;
	estValues: TradePickValues;
};

const refreshCache = () => {
	const season = g.get("season");
	if (cache === undefined || cache.cacheKey != season) {
		cache.cacheKey = season;
	}
};

const buildFairTrade = () => {
	refreshCache();
};

export default buildFairTrade;
