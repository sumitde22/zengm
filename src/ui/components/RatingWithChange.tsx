import clsx from "clsx";

const RatingWithChange = ({
	change,
	children,
	hideProgressions = false,
}: {
	change: number;
	children: number;
	hideProgressions?: boolean;
}) => {
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

export const wrappedRatingWithChange = (
	rating: number,
	change: number,
	hideProgressions = false,
) => {
	const formatted = `${rating} ${!hideProgressions && change !== 0 ? `(${change > 0 ? "+" : ""}${change})` : ""}`;

	return {
		value: (
			<RatingWithChange change={change} hideProgressions={hideProgressions}>
				{rating}
			</RatingWithChange>
		),
		sortValue: rating + (change + 500) / 1000,
		searchValue: formatted,
	};
};

export default RatingWithChange;
