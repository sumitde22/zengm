import { DataTable } from "../components/index.tsx";
import useTitleBar from "../hooks/useTitleBar.tsx";
import { getCols, helpers } from "../util/index.ts";
import type { View } from "../../common/types.ts";
import { bySport, isSport } from "../../common/index.ts";
import { wrappedPlayerNameLabels } from "../components/PlayerNameLabels.tsx";
import type { DataTableRow } from "../components/DataTable/index.tsx";

const PlayerFeats = ({
	abbrev,
	feats,
	quarterLengthFactor,
	season,
	stats,
	userTid,
}: View<"playerFeats">) => {
	useTitleBar({
		title: "Statistical Feats",
		dropdownView: "player_feats",
		dropdownFields: { teamsAndAll: abbrev, seasonsAndAll: season },
	});

	const cols = getCols([
		"Name",
		"Pos",
		"Team",
		...stats.map((stat) => `stat:${stat}`),
		"Opp",
		"Result",
		"Season",
		"Type",
	]);

	const rows: DataTableRow[] = feats.map((p) => {
		const result = `${p.result} ${p.score}`;

		return {
			key: p.fid,
			metadata: {
				type: "player",
				pid: p.pid,
				season: p.season,
				playoffs: p.type !== "allStar" ? p.type : "regularSeason",
			},
			data: [
				wrappedPlayerNameLabels({
					pid: p.pid,
					season: typeof season === "number" ? season : undefined,
					legacyName: p.name,
				}),
				p.pos,
				<a
					href={helpers.leagueUrl(["roster", `${p.abbrev}_${p.tid}`, p.season])}
				>
					{p.abbrev}
				</a>,
				...stats.map((stat) => helpers.roundStat(p.stats[stat], stat, true)),
				<a
					href={helpers.leagueUrl([
						"roster",
						`${p.oppAbbrev}_${p.oppTid}`,
						p.season,
					])}
				>
					{p.oppAbbrev}
				</a>,
				{
					value: (
						<a
							href={helpers.leagueUrl([
								"game_log",
								p.abbrev === undefined ? "special" : `${p.abbrev}_${p.tid}`,
								p.season,
								p.gid,
							])}
						>
							{result}
						</a>
					),
					sortValue: Number.parseInt(p.score.split("-")[0]!),
					searchValue: result,
				},
				p.season,
				p.type === "allStar"
					? "All-Star"
					: p.type === "playoffs"
						? "Playoffs"
						: "Regular season",
			],
			classNames: {
				"table-info": p.tid === userTid,
			},
		};
	});

	const superCols = isSport("football")
		? [
				{
					title: "",
					colspan: 3,
				},
				{
					title: "Passing",
					colspan: 4,
				},
				{
					title: "Rushing",
					colspan: 3,
				},
				{
					title: "Receiving",
					colspan: 3,
				},
				{
					title: "Defense",
					colspan: 7,
				},
				{
					title: "Returns",
					colspan: 2,
				},
				{
					title: "",
					colspan: 4,
				},
			]
		: undefined;

	const scaleMinimum = (amount: number) => {
		return Math.ceil(amount * quarterLengthFactor);
	};

	const scaleSpecial = (name: string, description: string, amount: number) => {
		const scaledAmount = scaleMinimum(amount);
		if (scaledAmount === amount) {
			return name;
		}

		return `scaled ${name} (${scaledAmount}+ ${description})`;
	};

	return (
		<>
			{bySport({
				baseball: (
					<p>
						This lists all games where a player got {scaleMinimum(3)} home runs,{" "}
						{scaleMinimum(5)} hits, {scaleMinimum(6)} RBIs, {scaleMinimum(4)}{" "}
						runs, {scaleMinimum(3)} stolen bases, {scaleMinimum(15)} strikeouts,
						a no hitter, a shutout, or hit for the cycle
						{quarterLengthFactor !== 1
							? " (cutoffs are scaled due to a non-default period length)"
							: null}
						. Statistical feats from your players are{" "}
						<span className="text-info">highlighted in blue</span>.
					</p>
				),
				basketball: (
					<p>
						This lists all games where a player got a{" "}
						{scaleSpecial("triple double", "in 3 stats", 10)}, a{" "}
						{scaleSpecial("5x5", "pts/reb/ast/stl/blk", 5)}, {scaleMinimum(50)}{" "}
						points, {scaleMinimum(25)} rebounds, {scaleMinimum(20)} assists,{" "}
						{scaleMinimum(10)} steals, {scaleMinimum(10)} blocks, or{" "}
						{scaleMinimum(10)} threes
						{quarterLengthFactor !== 1
							? " (cutoffs are scaled due to a non-default period length)"
							: null}
						. Statistical feats from your players are{" "}
						<span className="text-info">highlighted in blue</span>.
					</p>
				),
				football: (
					<p>
						All games where a player got {scaleMinimum(400)} passing yards,{" "}
						{scaleMinimum(6)} passing TDs, {scaleMinimum(150)} rushing yards,{" "}
						{scaleMinimum(3)} rushing TDs, {scaleMinimum(150)} receiving yards,{" "}
						{scaleMinimum(3)} receiving TDs, {scaleMinimum(3)} sacks,{" "}
						{scaleMinimum(2)} interceptions, {scaleMinimum(2)} fumble
						recoveries, {scaleMinimum(2)} forced fumbles, {scaleMinimum(2)}{" "}
						defensive TDs, {scaleMinimum(2)} return TDs, {scaleMinimum(4)}{" "}
						rushing/receiving TDs, {scaleMinimum(200)} rushing/receiving yards,
						or {scaleMinimum(5)} total TDs (where passing ones count half) are
						listed here. If you changed quarter length to a non-default value in
						God Mode, the cuttoffs are scaled. Statistical feats from your
						players are <span className="text-info">highlighted in blue</span>.
					</p>
				),
				hockey: (
					<p>
						All games where a player got a{" "}
						{scaleSpecial("hat trick", "goals", 3)}, {scaleMinimum(4)}+ points,
						or a shutout are listed here. If you changed quarter length to a
						non-default value in God Mode, the cuttoffs are scaled. Statistical
						feats from your players are{" "}
						<span className="text-info">highlighted in blue</span>.
					</p>
				),
			})}

			<DataTable
				cols={cols}
				defaultSort={[23, "desc"]}
				defaultStickyCols={window.mobile ? 0 : 1}
				name="PlayerFeats"
				rows={rows}
				superCols={superCols}
				pagination
			/>
		</>
	);
};

export default PlayerFeats;
