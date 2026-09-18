import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
export declare class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private connected;
    onModuleInit(): Promise<void>;
    isConnected(): boolean;
    onModuleDestroy(): Promise<void>;
}
