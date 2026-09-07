# Phase 4C regression inventory

Baseline commit: `30fb485`. The baseline was checked in a temporary detached worktree and removed afterwards.

| Validator group | Baseline | Current | Delta | Explanation |
|---|---:|---:|---:|---|
| 17 pre-Phase-4C validator scripts | 1,317 | 1,317 | 0 | Same filenames and equivalent commands. Two baseline scripts needed the existing workspace dependency tree, so their established counts (10 and 31) were used after confirming the scripts were unchanged. |
| Phase 4C sequence/campaign additions | 0 | 63 | +63 | 45 sequence/campaign/reporting assertions plus 18 controlled bootstrap assertions. |
| Total | 1,317 | 1,380 | +63 | No baseline validator or assertion was removed. |

Historical reported baseline `1,182` used a different/partial grouping and is 135 below the reproduced equivalent inventory. The reproducible file-by-file baseline is 1,317; current equivalent is also 1,317. Regression coverage is **PRESERVED**.
