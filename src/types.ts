// 只保留 legacy 11.3 需要的类型定义

export interface Task {
    id: number;
    name: string;
    status: string;
    pri: number;
    deadline?: string;
    desc?: string;
    story?: number | string;
    product?: number | string;
}

export interface Bug {
    id: number;
    title: string;
    status: string;
    severity: number;
    steps?: string;
    openedDate?: string;
    story?: number | string;
    product?: number | string;
    productName?: string;
}

export interface Product {
    id: number;
    name: string;
    code: string;
    status: string;
    desc: string;
}

export interface Story {
    id: number;
    title: string;
    status: string;
    pri: number;
    stage?: string;
    estimate?: number;
    openedBy?: string;
    openedDate?: string;
    assignedTo?: string;
    spec?: string;
    module?: string | number;
    moduleName?: string;
    product?: string | number;
    productName?: string;
    closedBy?: string;
    closedDate?: string;
    closedReason?: string;
}

export interface TaskUpdate {
    consumed?: number;
    left?: number;
    status?: TaskStatus;
    finishedDate?: string;
    comment?: string;
}

export interface BugResolution {
    resolution: 'fixed' | 'notrepro' | 'duplicate' | 'bydesign' | 'willnotfix' | 'tostory' | 'external';
    resolvedBuild?: string;
    duplicateBug?: number;
    comment?: string;
}

export interface TestCase {
    id: number;
    product?: number;
    productName?: string;
    module?: number;
    moduleName?: string;
    story?: number;
    title: string;
    type: string;
    pri: number;
    status: string;
    precondition?: string;
    steps?: string;
    openedBy?: string;
    openedDate?: string;
    lastEditedBy?: string;
    lastEditedDate?: string;
}

export interface TestResult {
    id: number;
    run: number;
    case: number;
    caseTitle?: string;
    version: number;
    status: string;
    lastRunner?: string;
    lastRunDate?: string;
    lastRunResult?: string;
}

export interface TestTask {
    id: number;
    name: string;
    product: number;
    productName?: string;
    project?: number;
    execution?: number;
    build?: string;
    owner?: string;
    status: string;
    begin?: string;
    end?: string;
    desc?: string;
}

export interface CreateTestCaseRequest {
    product: number;
    module?: number;
    story?: number;
    title: string;
    type?: string;
    pri?: number;
    precondition?: string;
    steps?: string;
    status?: string;
}

export interface TestRunRequest {
    caseId: number;
    version?: number;
    result: 'pass' | 'fail' | 'blocked' | 'skipped';
    steps?: string;
    comment?: string;
}

export type TaskStatus = 'wait' | 'doing' | 'done' | 'all';
export type BugStatus = 'active' | 'resolved' | 'closed' | 'all';
export type StoryStatus = 'draft' | 'active' | 'closed' | 'changed' | 'all';
export type TestCaseStatus = 'normal' | 'blocked' | 'investigate' | 'all';

