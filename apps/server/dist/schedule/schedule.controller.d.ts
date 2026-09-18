import type { UpsertScheduleTemplateDto } from '@timeblock/shared-types';
import { ScheduleTemplatesService } from './schedule.service';
export declare class ScheduleTemplatesController {
    private readonly service;
    constructor(service: ScheduleTemplatesService);
    list(userId: string): Promise<import("@timeblock/shared-types").DailyScheduleTemplateDto[]>;
    upsert(userId: string, body: UpsertScheduleTemplateDto): Promise<import("@timeblock/shared-types").DailyScheduleTemplateDto>;
    applyAll(userId: string, body: {
        workStart: string;
        workEnd: string;
        breaks: Array<{
            name: string;
            start: string;
            end: string;
        }>;
    }): Promise<import("@timeblock/shared-types").DailyScheduleTemplateDto[]>;
}
