import clsx from "clsx";
import { useLocalPartial } from "../util/index.ts";

const RatingWithChange = ({
	change,
	children,
}: {
	change: number;
	children: number;
	hideProgressions?: boolean;
}) => {
	const hideProgressions = useLocalPartial(["hideProgressions"]);
	return (
		<>
			{children}
			{!hideProgressions && change !== 0 ? (
				<span
					className={clsx({
						"text-success": change > 0,
						"text-danger": change < 0,
					})}
				>
					{" "}
					({change > 0 ? "+" : null}
					{change})
				</span>
			) : null}
		</>
	);
};

export const wrappedRatingWithChange = (rating: number, change: number) => {
	const hideProgressions = useLocalPartial(["hideProgressions"]);
	const formatted = `${rating} ${!hideProgressions && change !== 0 ? `(${change > 0 ? "+" : ""}${change})` : ""}`;

	return {
		value: <RatingWithChange change={change}>{rating}</RatingWithChange>,
		sortValue: rating + (change + 500) / 1000,
		searchValue: formatted,
	};
};

export default RatingWithChange;
