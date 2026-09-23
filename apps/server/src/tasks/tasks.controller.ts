import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  CreateRecurringTaskDto,
  CreateTaskDto,
  ReorderTasksDto,
  ScheduleBacklogTaskDto,
  UpdateTaskDto,
} from '@timeblock/shared-types';
import { SessionAuthGuard } from '../auth/session.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(SessionAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('backlog')
  listBacklog(@CurrentUserId() userId: string) {
    return this.tasksService.listBacklog(userId);
  }

  @Get('recurring')
  listRecurring(@CurrentUserId() userId: string) {
    return this.tasksService.listRecurring(userId);
  }

  @Post('recurring')
  createRecurring(
    @CurrentUserId() userId: string,
    @Body() body: CreateRecurringTaskDto,
  ) {
    return this.tasksService.createRecurring(userId, body);
  }

  @Delete('recurring/:id')
  deleteRecurring(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.tasksService.deleteRecurring(userId, id);
  }

  @Get()
  list(
    @CurrentUserId() userId: string,
    @Query('date') date: string,
  ) {
    return this.tasksService.list(userId, date);
  }

  @Post()
  create(@CurrentUserId() userId: string, @Body() body: CreateTaskDto) {
    return this.tasksService.create(userId, body);
  }

  @Post('reorder')
  reorder(@CurrentUserId() userId: string, @Body() body: ReorderTasksDto) {
    return this.tasksService.reorder(userId, body.date, body.taskIds);
  }

  @Post(':id/schedule')
  scheduleFromBacklog(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() body: ScheduleBacklogTaskDto,
  ) {
    return this.tasksService.scheduleFromBacklog(userId, id, body ?? {});
  }

  @Post(':id/backlog')
  moveToBacklog(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.tasksService.moveToBacklog(userId, id);
  }

  @Patch(':id/complete')
  complete(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.tasksService.complete(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() body: UpdateTaskDto,
  ) {
    return this.tasksService.update(userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.tasksService.remove(userId, id);
  }
}
