import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export function projectBasename(value: string): string {
	const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
	if (!normalized) return "";
	const parts = normalized.split("/");
	return parts[parts.length - 1] ?? "";
}

export function projectColumnClause(
	columnExpr: string,
	project: string,
): { clause: string; params: string[] } {
	const trimmed = project.trim();
	if (!trimmed) return { clause: "", params: [] };
	const isAbsolutePath = trimmed.startsWith("/") || trimmed.startsWith("\\");
	const slashCount = (trimmed.match(/[\/\\]/g) || []).length;
	const isScopedProject = !isAbsolutePath && slashCount === 1;
	const basenameValue = projectBasename(trimmed);
	if (!basenameValue) return { clause: "", params: [] };
	if (isAbsolutePath || slashCount > 1) {
		return {
			clause: `(${columnExpr} = ? OR ${columnExpr} LIKE ? OR ${columnExpr} LIKE ?)`,
			params: [basenameValue, `%/${basenameValue}`, `%\\${basenameValue}`],
		};
	}
	if (isScopedProject) {
		return {
			clause: `(${columnExpr} = ? OR ${columnExpr} LIKE ? OR ${columnExpr} LIKE ? OR ${columnExpr} = ? OR ${columnExpr} LIKE ? OR ${columnExpr} LIKE ?)`,
			params: [trimmed, `%/${trimmed}`, `%\\${trimmed}`, basenameValue, `%/${basenameValue}`, `%\\${basenameValue}`],
		};
	}
	return {
		clause: `(${columnExpr} = ? OR ${columnExpr} LIKE ? OR ${columnExpr} LIKE ? OR ${columnExpr} LIKE ? OR ${columnExpr} LIKE ?)`,
		params: [trimmed, `%/${trimmed}`, `%\\${trimmed}`, `${trimmed}/%`, `${trimmed}\\%`],
	};
}

export function projectClause(project: string): { clause: string; params: string[] } {
	return projectColumnClause("sessions.project", project);
}

export function projectMatchesFilter(
	projectFilter: string | null | undefined,
	itemProject: string | null | undefined,
): boolean {
	if (!projectFilter) return true;
	if (!itemProject) return false;
	const normalizedFilter = projectFilter.trim().replaceAll("\\", "/");
	if (!normalizedFilter) return true;
	const normalizedProject = itemProject.replaceAll("\\", "/");
	if (normalizedProject === normalizedFilter) return true;
	if (normalizedProject.endsWith(`/${normalizedFilter}`)) return true;
	if (normalizedFilter.includes("/")) {
		const filterBase = projectBasename(normalizedFilter);
		if (normalizedProject === filterBase || normalizedProject.endsWith(`/${filterBase}`)) return true;
		return false;
	}
	return normalizedProject.startsWith(`${normalizedFilter}/`);
}

function findGitAnchor(startCwd: string): string | null {
	let current = resolve(startCwd);
	while (true) {
		const gitPath = resolve(current, ".git");
		if (existsSync(gitPath)) {
			try {
				if (lstatSync(gitPath).isDirectory()) {
					return current;
				}
				const text = readFileSync(gitPath, "utf8").trim();
				if (text.startsWith("gitdir:")) {
					const gitdir = resolve(current, text.slice("gitdir:".length).trim()).replaceAll(
						"\\",
						"/",
					);
					const worktreeMarker = "/.git/worktrees/";
					const worktreeIndex = gitdir.indexOf(worktreeMarker);
					if (worktreeIndex >= 0) {
						return gitdir.slice(0, worktreeIndex);
					}
				}
				return current;
			} catch {
				return current;
			}
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function resolveProject(cwd: string, override?: string | null): string | null {
	if (override != null) {
		const trimmed = override.trim();
		return trimmed || null;
	}
	const gitAnchor = findGitAnchor(cwd);
	if (gitAnchor) {
		return basename(gitAnchor);
	}
	return basename(resolve(cwd));
}
