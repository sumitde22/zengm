import useTitleBar from "../hooks/useTitleBar.tsx";
import { helpers, getCols, useLocalPartial } from "../util/index.ts";
import {
	DataTable,
	RatingWithChange,
	StatWithChange,
	MoreLinks,
} from "../components/index.tsx";
import type { View } from "../../common/types.ts";
import { PLAYER } from "../../common/index.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";

const AwardRaces = ({
	awardCandidates,
	challengeNoRatings,
	season,
	teams,
	userTid,
}: View<"awardRaces">) => {
	const { hideProgressions } = useLocalPartial(["hideProgressions"]);
	useTitleBar({
		title: "Award Races",
		jumpTo: true,
		jumpToSeason: season,
		dropdownView: "award_races",
		dropdownFields: {
			seasons: season,
		},
	});

	const globalCols = getCols(["#", "Name", "Pos", "Age", "Team"]);

	return (
		<>
			<MoreLinks type="awards" page="award_races" season={season} />

			<div className="row" style={{ marginTop: -14 }}>
				{awardCandidates.map(({ name, players, stats }) => {
					const mip = name === "Most Improved Player";
					const roy = name === "Rookie of the Year";

					const cols = [
						...globalCols,
						...getCols([roy ? "Pick" : "Record", "Ovr"]),
						...getCols(stats.map((stat) => `stat:${stat}`)),
					];

					if (mip) {
						cols.push(...getCols(["Compare"]));
					}

					const rows: DataTableRow[] = players.map((p, j) => {
						let ps: any;
						for (let i = p.stats.length - 1; i >= 0; i--) {
							if (p.stats[i].season === season && !p.stats[i].playoffs) {
								ps = p.stats[i];
								break;
							}
						}
						let pr;
						for (let i = p.ratings.length - 1; i >= 0; i--) {
							if (p.ratings[i].season === season) {
								pr = p.ratings[i];
								break;
							}
						}

						const pos = pr ? pr.pos : "?";
						const abbrev = ps ? ps.abbrev : undefined;
						const tid = ps ? ps.tid : undefined;

						const t = teams.find((t) => t.tid === tid);

						let recordOrPick = null;
						if (roy) {
							if (p.draft.round > 0) {
								recordOrPick = `${p.draft.round}-${p.draft.pick}`;
							}
						} else {
							if (t) {
								recordOrPick = helpers.formatRecord(t.seasonAttrs);
							}
						}

						const data = [
							j + 1,
							wrappedPlayerNameLabels({
								injury: p.injury,
								jerseyNumber: ps ? ps.jerseyNumber : undefined,
								pid: p.pid,
								season,
								skills: pr ? pr.skills : [],
								watch: p.watch,
								firstName: p.firstName,
								firstNameShort: p.firstNameShort,
								lastName: p.lastName,
							}),
							pos,
							p.age,
							<>
								<a
									href={helpers.leagueUrl([
										"roster",
										`${abbrev}_${tid}`,
										season,
									])}
								>
									{abbrev}
								</a>
							</>,
							recordOrPick,
						];

						const showRatings = !challengeNoRatings || p.tid === PLAYER.RETIRED;

						if (mip) {
							data.push(
								pr && showRatings ? (
									<RatingWithChange
										change={pr.dovr}
										hideProgressions={hideProgressions}
									>
										{pr.ovr}
									</RatingWithChange>
								) : undefined,
							);

							let ps2: any;
							for (let i = p.stats.length - 1; i >= 0; i--) {
								if (p.stats[i].season === season - 1 && !p.stats[i].playoffs) {
									ps2 = p.stats[i];
									break;
								}
							}
							data.push(
								...stats.map((stat) => {
									if (!ps && !ps2) {
										return undefined;
									}

									if (!ps2) {
										return helpers.roundStat(ps[stat], stat);
									}

									return (
										<StatWithChange change={ps[stat] - ps2[stat]} stat={stat}>
											{ps[stat]}
										</StatWithChange>
									);
								}),
								<a
									href={helpers.leagueUrl([
										"compare_players",
										`${p.pid}-${season - 1}-r,${p.pid}-${season}-r`,
									])}
								>
									Compare
								</a>,
							);
						} else {
							data.push(pr && showRatings ? pr.ovr : undefined);
							const statsRow = stats.map((stat) =>
								ps ? helpers.roundStat(ps[stat], stat) : undefined,
							);
							data.push(...statsRow);
						}

						return {
							key: p.pid,
							metadata: {
								type: "player",
								pid: p.pid,
								season,
								playoffs: "regularSeason",
							},
							data,
							classNames: {
								"table-danger": p.hof,
								"table-info": tid === userTid,
							},
						};
					});

					return (
						<div
							key={name}
							className={mip ? "col-12 col-lg-9" : "col-12 col-lg-6"}
							style={{ marginTop: 14 }}
						>
							{rows.length > 0 ? (
								<DataTable
									classNameWrapper="mb-1"
									cols={cols}
									defaultSort={[0, "asc"]}
									defaultStickyCols={window.mobile ? 0 : 2}
									hideAllControls
									name={`AwardRaces${name}`}
									rows={rows}
									title={<h2>{name}</h2>}
								/>
							) : (
								<>
									<h2>{name}</h2>
									<p>No candidates yet...</p>
								</>
							)}
						</div>
					);
				})}
			</div>
		</>
	);
};

export default AwardRaces;
