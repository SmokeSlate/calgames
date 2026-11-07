# CalGames
###### A calculater games website with auto

## Offline regression checks

Run `npm ci` then `npm test`. Tests execute actual inline page scripts with jsdom,
use a mocked uploader bridge/WebUSB discovery seam, and validate all 87 tracked
program/appvar binaries without accessing USB hardware or live forms.

The uploader supports one selected file. Load and send each listed file individually
before choosing the next. The former bulk-load control was removed because it only
replaced that selection repeatedly. Open PR #16 changes the transfer UI independently;
the file-validation/hot-plug fixes here apply to the bundled library and do not copy
that UI redesign.

The variable-file validator checks supported file signatures, total size, checksum,
entry header bounds and both copies of each data length before parsing entries.
Byte 10 remains a product/export identifier, preserving valid hosted files with
nonzero values. References: [TI variable layout](https://merthsoft.com/linkguide/ti83%2B/fformat.html)
and [modern header product identifiers](https://github.com/TI-Toolkit/tivars_lib_py/wiki/Var-Files).

These are offline checks, not verification of real calculator transfers, firmware
compatibility or delivery by an external contact backend.
