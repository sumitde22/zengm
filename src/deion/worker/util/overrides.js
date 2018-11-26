// @flow

import type {
    CompositeWeights,
    Names,
    WorkerOverridesCore,
    WorkerOverridesUtil,
} from "../../common/types";

const overrides: {
    COMPOSITE_WEIGHTS: CompositeWeights<>,
    core: WorkerOverridesCore,
    names: Names,
    util: WorkerOverridesUtil,
    views: {
        [key: string]: any,
    },
} = {
    COMPOSITE_WEIGHTS: {},
    core: {
        player: {},
        season: {},
    },
    names: {
        first: {},
        last: {},
    },
    util: {
        achievements: {},
        advStats: async () => {},
        changes: [],
        emptyPlayerStatsRow: {},
        emptyTeamStatsRow: {},
    },
    views: {},
};

export default overrides;
