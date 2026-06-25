import { registerWriteGuardBranchPolicyInvalidProtectedScenarios } from './version-refs-write-guards-branch-policy-invalid-protected-scenarios';
import { registerWriteGuardBranchPolicyLifecycleScenarios } from './version-refs-write-guards-branch-policy-lifecycle-scenarios';
import { registerWriteGuardBranchPolicyRenameScenarios } from './version-refs-write-guards-branch-policy-rename-scenarios';

export function registerWriteGuardBranchPolicyScenarios(): void {
  registerWriteGuardBranchPolicyInvalidProtectedScenarios();
  registerWriteGuardBranchPolicyRenameScenarios();
  registerWriteGuardBranchPolicyLifecycleScenarios();
}
