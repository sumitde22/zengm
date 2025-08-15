const getValue = (player, strategy) => {
	let playerValue = p.value;

	// These factors don't make sense for negative value players!!!
	if (strategy === "rebuilding") {
		// Value young/cheap players and draft picks more. Penalize expensive/old players
		if (p.age <= 19) {
			playerValue *= 1.075;
		} else if (p.age === 20) {
			playerValue *= 1.05;
		} else if (p.age === 21) {
			playerValue *= 1.0375;
		} else if (p.age === 22) {
			playerValue *= 1.025;
		} else if (p.age === 23) {
			playerValue *= 1.0125;
		} else if (p.age === 27) {
			playerValue *= 0.975;
		} else if (p.age === 28) {
			playerValue *= 0.95;
		} else if (p.age >= 29) {
			playerValue *= 0.9;
		}
	} else if (strategy === "contending") {
		if (p.age <= 19) {
			playerValue *= 0.8;
		} else if (p.age === 20) {
			playerValue *= 0.825;
		} else if (p.age === 21) {
			playerValue *= 0.85;
		} else if (p.age === 22) {
			playerValue *= 0.875;
		} else if (p.age === 23) {
			playerValue *= 0.925;
		} else if (p.age === 24) {
			playerValue *= 0.95;
		}
	}

	const contractsFactor = strategy === "rebuilding" ? 2 : 0.5;
	playerValue += contractsFactor * p.contractValue;

	return playerValue > 1 ? playerValue ** 7 : playerValue;
};

async function getExpansionDraftIntel() {
	const players = await bbgm.idb.cache.players.getAll();
}

await getExpansionDraftIntel();
