import { local } from "../../util";
import { idb } from "../../db";

// Note: this is currently only being at the beginning of the season
// Should this also be called after the playoffs/before the draft to account for
// player ovrs reduced by injuries?
const updateOvrMeanStd = async () => {
	if (local.playerOvrMeanStdStale) {
		const players = await idb.cache.players.indexGetAll("playersByTid", [
			-1,
			Infinity,
		]);

		if (players.length > 0) {
			let sum = 0;
			for (const p of players) {
				sum += p.ratings.at(-1)!.ovr;
			}
			local.playerOvrMean = sum / players.length;

			let sumSquareDeviations = 0;
			for (const p of players) {
				sumSquareDeviations +=
					(p.ratings.at(-1)!.ovr - local.playerOvrMean) ** 2;
			}
			local.playerOvrStd = Math.sqrt(sumSquareDeviations / players.length);

			local.playerOvrMeanStdStale = false;
		}
	}
};

export default updateOvrMeanStd;
