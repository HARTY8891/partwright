# The Partwright part file (`.pwpart`)

A `.pwpart` file is plain JSON, UTF-8. You can open it in any text editor, keep
it in git, and diff it. Nothing in it is encrypted or tied to an account,
a licence or a machine.

## The promise

**Every newer Partwright opens every older part file.** Each change to the
format gets a new `schemaVersion` and an upgrade step in
`src/model/migrate.ts`, and the steps run in order when a file is opened. Old
steps are never removed.

A file saved by a *newer* Partwright than the one you are running is refused
with a message saying so. It is never half-read. Reload the page to get the
latest version.

## Top level

| field | type | meaning |
| --- | --- | --- |
| `schemaVersion` | number | format version, currently `1` |
| `id` | string | uuid of the part |
| `name` | string | part name |
| `units` | `"mm"` \| `"in"` | display units only: **every length in the file is millimetres** |
| `createdAt`, `updatedAt` | ISO 8601 UTC | |
| `features` | array | the history, in order (see below) |
| `rollbackIndex` | number | features before this index are built |
| `variables` | array, optional | `{ id, name, expression }`; expressions in display units |
| `material` | string, optional | material id for mass properties |

Angles are degrees (revolve, pattern total angle, angle dimensions). A value the
user typed is stored as `{ "expr": "=width/2", "value": 25 }`. `expr` is what
they typed, `value` is millimetres (or degrees).

## Features

Every feature has `id`, `name`, `suppressed` and `type`. The first three are
always the default planes (`front`, `top`, `right`).

| type | main fields |
| --- | --- |
| `plane` | `def`: `{type:"default", which}` or `{type:"offset", base, distance}` |
| `sketch` | `on` (a plane, or a named face), `sketch` (entities, constraints, dimensions) |
| `extrude`, `cutExtrude` | `sketchId`, `direction1`, optional `direction2`, `reverse` |
| `revolve`, `cutRevolve` | `sketchId`, `axisLineId`, `angle`, `reverse` |
| `fillet`, `chamfer` | `edges` (named edges), `size` |
| `hole` | `at` (a named face and a 2D point on it), `diameter`, `end` |
| `shell` | `faces` (named faces with points), `thickness` |
| `linearPattern`, `circularPattern` | `seeds`, `axis`, `count`, `spacing`, `reverse` |
| `mirror` | `seeds`, `planeId` |

### Named faces and edges

Faces and edges are named by the feature and sketch element that made them,
not by number. That is how references survive edits:

- face: `{kind:"cap", featureId, cap:"start"|"end", flip}` or `{kind:"side", featureId, segmentId, flip}`
- edge: `{kind:"capEdge", featureId, cap, segmentId}` or `{kind:"sideEdge", featureId, pointId}`

The exact TypeScript types are in `src/model/types.ts`.

## Exchanging with other CAD

Use **File ▸ Export STEP** for other CAD programs (geometry only, no history),
and **Export STL** for 3D printing.
