import type {
  Conflict,
  LocalFile,
  RemoteFile,
  RemoteState,
} from "./types";

export interface PullPlan {
  path: string;
  remote?: RemoteFile;
}

export interface PushPlan {
  path: string;
  local?: LocalFile;
}

export interface CompareResult {
  pull: PullPlan[];
  push: PushPlan[];
  conflicts: Conflict[];
}

/**
 * Three-way comparison between the local vault, the current remote tree, and
 * the tree at the last successful sync.
 *
 * local / remote / base are Git blob SHAs, or null when the file is missing.
 */
export function compareStates(
  local: Map<string, LocalFile>,
  remote: RemoteState
): CompareResult {
  const pull: PullPlan[] = [];
  const push: PushPlan[] = [];
  const conflicts: Conflict[] = [];

  const paths = new Set<string>();
  for (const path of local.keys()) paths.add(path);
  for (const path of remote.tree.keys()) paths.add(path);
  for (const path of remote.baseTree.keys()) paths.add(path);

  for (const path of paths) {
    const localFile = local.get(path);
    const remoteFile = remote.tree.get(path);
    const baseFile = remote.baseTree.get(path);

    const localSha = localFile?.sha ?? null;
    const remoteSha = remoteFile?.sha ?? null;
    const baseSha = baseFile?.sha ?? null;

    if (localSha === remoteSha) continue;

    if (!baseSha) {
      if (localSha && remoteSha) {
        conflicts.push({ path, localSha, remoteSha, baseSha });
      } else if (remoteSha) {
        pull.push({ path, remote: remoteFile });
      } else if (localSha) {
        push.push({ path, local: localFile });
      }
      continue;
    }

    if (localSha === baseSha) {
      if (remoteSha) {
        pull.push({ path, remote: remoteFile });
      } else {
        pull.push({ path });
      }
      continue;
    }

    if (remoteSha === baseSha) {
      if (localSha) {
        push.push({ path, local: localFile });
      } else {
        push.push({ path });
      }
      continue;
    }

    conflicts.push({ path, localSha, remoteSha, baseSha });
  }

  return { pull, push, conflicts };
}
