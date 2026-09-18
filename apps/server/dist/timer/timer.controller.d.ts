import { TimerService } from './timer.service';
export declare class TimerController {
    private readonly timerService;
    constructor(timerService: TimerService);
    start(userId: string, taskId: string): Promise<import("@timeblock/shared-types").TaskDto | undefined>;
    stop(userId: string, taskId: string): Promise<import("@timeblock/shared-types").TaskDto | undefined>;
}
