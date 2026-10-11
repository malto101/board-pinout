Board Pinout
============

An interactive board pinout demo powered by the ``board_pinout`` Sphinx
extension. This page uses the checked-in ESP32-S3 DevKitC sample, so it is a
real example of the same YAML and underlay workflow used by consuming docs.

Try the interactive diagram
---------------------------

.. board-pinout:: esp32s3_devkitc
   :face: top

The viewer supports search, marker selection, pan and zoom, hierarchical
drill-down, and peripheral filtering when mux data is present. Try the
controls above, or use the hosted editor at
`https://malto101.github.io/board-pinout/editor/`_ to author a board visually.

The editor imports and exports board ``pinout.yaml`` files. For SoC-backed boards,
use this flow:

#. Create or import a SoC pad table, add canonical pad names and aliases, then
   add intrinsic electrical data and functions. Keep packages, routing, remaps,
   and signal-selection rules in the advanced table data.
#. Export the separate ``socpad.yaml`` table.
#. In the board document, set ``soc``, optional ``soc_package``, and
   ``mux_source: soc``. Load/link the matching table in the editor.
#. Create board parts and choose their **SoC pad** from the canonical/alias-aware
   selector. The inspector then previews inherited pad electrical data and mux
   candidates; authored board mux entries remain separate overrides.
#. Export ``pinout.yaml`` and place both files at the consuming project's
   canonical paths, such as ``soc/<vendor>/<soc>/doc/pinmux/<soc>.yaml`` and
   ``boards/<vendor>/<board>/doc/pinout.yaml`` in Zephyr.

The board file stores the authored pad reference and overrides. The resolver
materializes ``pad_info`` and inherited mux entries when consuming documentation
or validation; the editor does not copy those derived fields into the board file.
If the linked table does not match the board SoC/package, the editor reports the
mismatch instead of showing stale derived details.

.. _https://malto101.github.io/board-pinout/editor/: https://malto101.github.io/board-pinout/editor/


Build this demo locally
-----------------------

From the repository root::

   python -m pip install -e ".[sphinx]"
   sphinx-build -b html docs docs/_build/html

Open ``docs/_build/html/index.html`` in a browser. The example source is in
``docs/example/esp32s3_devkitc/``; its image path is relative to its
``pinout.yaml``.

What this demonstrates
----------------------

* ``board_pinout.sphinx_ext`` discovers and resolves a board YAML.
* The package supplies the schema, base types, JavaScript, and CSS.
* The Sphinx extension copies the board underlay into the generated site.
* The same board can be edited in the Vite editor and exported as YAML.
