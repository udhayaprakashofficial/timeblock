export type LocalUser = {
    id: string;
    email: string;
    name: string;
    theme: 'light' | 'dark';
    googleId?: string;
    accessToken?: string;
    refreshToken?: string;
    passwordHash?: string;
    connectedProviders: Array<'google' | 'microsoft'>;
};
/**
 * File-backed user store used when Supabase/Postgres is unreachable.
 */
export declare class LocalUserStore {
    private readonly dir;
    private readonly file;
    private read;
    private write;
    upsertGoogle(input: {
        email: string;
        name: string;
        googleId: string;
        accessToken: string;
        refreshToken?: string;
    }): LocalUser;
    save(user: LocalUser): LocalUser;
    findById(id: string): LocalUser | null;
    findByEmail(email: string): LocalUser | null;
    upsertPassword(input: {
        email: string;
        name: string;
        passwordHash: string;
    }): LocalUser;
}
