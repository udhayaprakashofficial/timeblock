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
  AiBrandSummaryRequestDto,
  AiBrainDumpRequestDto,
  AiCareerSummaryRequestDto,
  AiCoachRequestDto,
  AiDailyPlanRequestDto,
  AiEstimateRequestDto,
  AiFocusRequestDto,
  AiHomerPersistRequestDto,
  AiPrioritizeRequestDto,
  AiRecoverRequestDto,
  AiTaskPostRequestDto,
} from '@timeblock/shared-types';
import { SessionAuthGuard } from '../auth/session.guard';
import { CurrentUserId } from '../auth/current-user.decorator';
import { AiService } from './ai.service';
import { AiFeaturesService } from './ai-features.service';

@Controller('ai')
@UseGuards(SessionAuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly features: AiFeaturesService,
  ) {}

  @Get('access')
  access(@CurrentUserId() userId: string) {
    return this.features.access(userId);
  }

  @Get('task-posts')
  taskPosts(
    @CurrentUserId() userId: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.aiService.listTaskPosts(userId, taskId);
  }

  @Get('homer-generations')
  homerGenerations(
    @CurrentUserId() userId: string,
    @Query('mode') mode?: string,
  ) {
    return this.aiService.listHomerGenerations(userId, mode);
  }

  @Delete('homer-generations/:id')
  deleteHomerGeneration(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.aiService.deleteHomerGeneration(userId, id);
  }

  @Post('homer-generations')
  persistHomerGeneration(
    @CurrentUserId() userId: string,
    @Body() body: AiHomerPersistRequestDto,
  ) {
    return this.aiService.persistHomerGeneration(userId, body ?? {});
  }

  @Patch('task-posts/:id')
  updateTaskPost(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() body: { summary?: string },
  ) {
    return this.aiService.updateTaskPost(
      userId,
      id,
      body?.summary ?? '',
    );
  }

  @Delete('task-posts/:id')
  deleteTaskPost(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return this.aiService.deleteTaskPost(userId, id);
  }

  @Post('brand-summary')
  async brandSummary(
    @CurrentUserId() userId: string,
    @Body() body: AiBrandSummaryRequestDto,
  ) {
    await this.features.assertAccess(userId);
    const result = await this.aiService.brandSummary(
      userId,
      body ?? ({} as AiBrandSummaryRequestDto),
    );
    await this.features.charge(userId);
    return result;
  }

  @Post('task-post')
  async taskPost(
    @CurrentUserId() userId: string,
    @Body() body: AiTaskPostRequestDto,
  ) {
    await this.features.assertAccess(userId);
    const result = await this.aiService.taskPost(
      userId,
      body ?? ({} as AiTaskPostRequestDto),
    );
    await this.features.charge(userId);
    return result;
  }

  @Post('career-summary')
  async careerSummary(
    @CurrentUserId() userId: string,
    @Body() body: AiCareerSummaryRequestDto,
  ) {
    await this.features.assertAccess(userId);
    const result = await this.aiService.careerSummary(
      userId,
      body ?? ({} as AiCareerSummaryRequestDto),
    );
    await this.features.charge(userId);
    return result;
  }

  @Post('daily-plan')
  dailyPlan(
    @CurrentUserId() userId: string,
    @Body() body: AiDailyPlanRequestDto,
  ) {
    return this.features.dailyPlan(userId, body ?? ({} as AiDailyPlanRequestDto));
  }

  @Post('brain-dump')
  brainDump(
    @CurrentUserId() userId: string,
    @Body() body: AiBrainDumpRequestDto,
  ) {
    return this.features.brainDump(userId, body ?? ({} as AiBrainDumpRequestDto));
  }

  @Post('estimate')
  estimate(
    @CurrentUserId() userId: string,
    @Body() body: AiEstimateRequestDto,
  ) {
    return this.features.estimate(userId, body ?? ({} as AiEstimateRequestDto));
  }

  @Post('prioritize')
  prioritize(
    @CurrentUserId() userId: string,
    @Body() body: AiPrioritizeRequestDto,
  ) {
    return this.features.prioritize(
      userId,
      body ?? ({} as AiPrioritizeRequestDto),
    );
  }

  @Post('recover')
  recover(
    @CurrentUserId() userId: string,
    @Body() body: AiRecoverRequestDto,
  ) {
    return this.features.recover(userId, body ?? ({} as AiRecoverRequestDto));
  }

  @Post('coach')
  coach(@CurrentUserId() userId: string, @Body() body: AiCoachRequestDto) {
    return this.features.coach(userId, body ?? ({} as AiCoachRequestDto));
  }

  @Post('focus')
  focus(@CurrentUserId() userId: string, @Body() body: AiFocusRequestDto) {
    return this.features.focus(userId, body ?? ({} as AiFocusRequestDto));
  }
}
