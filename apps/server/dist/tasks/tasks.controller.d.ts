import type { CreateTaskDto, ReorderTasksDto, ScheduleBacklogTaskDto, UpdateTaskDto } from '@timeblock/shared-types';
import { TasksService } from './tasks.service';
export declare class TasksController {
    private readonly tasksService;
    constructor(tasksService: TasksService);
    listBacklog(userId: string): Promise<import("@timeblock/shared-types").TaskDto[]>;
    list(userId: string, date: string): Promise<import("@timeblock/shared-types").TaskDto[]>;
    create(userId: string, body: CreateTaskDto): Promise<import("@timeblock/shared-types").TaskDto>;
    reorder(userId: string, body: ReorderTasksDto): Promise<import("@timeblock/shared-types").TaskDto[]>;
    scheduleFromBacklog(userId: string, id: string, body: ScheduleBacklogTaskDto): Promise<import("@timeblock/shared-types").TaskDto>;
    moveToBacklog(userId: string, id: string): Promise<import("@timeblock/shared-types").TaskDto>;
    complete(userId: string, id: string): Promise<import("@timeblock/shared-types").TaskDto>;
    update(userId: string, id: string, body: UpdateTaskDto): Promise<import("@timeblock/shared-types").TaskDto>;
    remove(userId: string, id: string): Promise<{
        ok: boolean;
    }>;
}
