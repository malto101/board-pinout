# Part type library

Vendor-neutral core types only (`base.yaml`). Board- or vendor-specific headers
(Beagle P8/P9, Arduino R3, Pi 40-pin, Nordic DK clusters, …) live in the
**consuming docs tree** as `types_inline` on that board’s `pinout.yaml`.

## Editor palette

Any type with an `editor:` block appears under New part (after
`npm run sync-types`).

```yaml
my_part:
  kind: pin
  description: …
  editor:
    order: 200
    label: My part
    silk: MY
    sym: io
    group:
      ref: pin_group
      label: My group
      silk: MY
      child_kind: pin
      child_silk: "MY{n}"
```

Set `editor.palette: false` to keep metadata but hide the row.
