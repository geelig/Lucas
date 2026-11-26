export interface FollowDirectoryState { sessionId: string; cwd?: string; followCwd: boolean }

export function shouldFollowDirectory(previous: FollowDirectoryState, next: FollowDirectoryState): boolean {
  return next.followCwd && Boolean(next.cwd) && previous.sessionId === next.sessionId
    && (!previous.followCwd || previous.cwd !== next.cwd);
}
