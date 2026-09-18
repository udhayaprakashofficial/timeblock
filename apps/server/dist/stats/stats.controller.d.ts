import { StatsService } from './stats.service';
export declare class StatsController {
    private readonly statsService;
    constructor(statsService: StatsService);
    overview(userId: string, date: string): Promise<import("../shared-types").StatsOverviewDto>;
    weekly(userId: string, date: string): Promise<import("../shared-types").WeeklyReportDto>;
    eod(userId: string, date: string): Promise<import("../shared-types").EodSheetDto>;
}
