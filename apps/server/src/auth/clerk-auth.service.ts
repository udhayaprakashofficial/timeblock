import { createClerkClient, verifyToken } from '@clerk/backend';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClerkAuthService {
  private clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY ?? '',
  });

  constructor(private readonly prisma: PrismaService) {}

  isConfigured() {
    return Boolean(
      process.env.CLERK_SECRET_KEY?.trim() &&
        process.env.CLERK_PUBLISHABLE_KEY?.trim(),
    );
  }

  /**
   * Verify Clerk session JWT, upsert local User, return app user id.
   * End users only sign in with Google — they never handle OAuth secrets.
   */
  async syncFromToken(token: string): Promise<{ id: string }> {
    if (!this.isConfigured()) {
      throw new UnauthorizedException('Clerk auth is not configured');
    }

    let clerkUserId: string;
    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      clerkUserId = payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid Clerk session');
    }

    const clerkUser = await this.clerk.users.getUser(clerkUserId);
    const email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) {
      throw new UnauthorizedException('Google account has no email');
    }

    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') ||
      clerkUser.fullName ||
      email;

    const existingByClerk = await this.prisma.user.findUnique({
      where: { clerkId: clerkUserId },
    });
    if (existingByClerk) {
      await this.prisma.user.update({
        where: { id: existingByClerk.id },
        data: { name, email: email.toLowerCase() },
      });
      return existingByClerk;
    }

    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existingByEmail) {
      return this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: { clerkId: clerkUserId, name },
      });
    }

    return this.prisma.user.create({
      data: {
        clerkId: clerkUserId,
        email: email.toLowerCase(),
        name,
        onboardingCompleted: false,
      },
    });
  }
}
