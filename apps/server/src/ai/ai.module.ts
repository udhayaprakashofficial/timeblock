import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiFeaturesService } from './ai-features.service';
import { AiCreditsStore } from './ai-credits.store';
import { TaskAiPostsStore } from './task-ai-posts.store';
import { HomerGenerationsStore } from './homer-generations.store';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => UsersModule)],
  controllers: [AiController],
  providers: [
    AiService,
    AiFeaturesService,
    AiCreditsStore,
    TaskAiPostsStore,
    HomerGenerationsStore,
  ],
  exports: [AiService, AiFeaturesService],
})
export class AiModule {}
