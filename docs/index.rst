Board Pinout
============

An interactive board pinout demo powered by the ``board_pinout`` Sphinx
extension. This page includes a real ESP32-S3 DevkitC-1, BeagleBone AI-64 and BeagleY-AI example,
using the same YAML and underlay workflow used by consuming docs.

The archetype gallery uses five independent SoC-backed board documents. Each
sample keeps the SoC pad table separate from the board pinout so the viewer can
show inherited pad facts, mux provenance, and the hardware-specific selection
mechanism.

The five models supported are fixed per-pad modes (J721E), per-pad ``ALT`` plus daisy
input selection (i.MX RT1062), peripheral-wide remap (STM32F1), signal-owned
selection bits (NPCX ``DEVALT``), and any-pin PSEL routing (nRF52840).

Try the interactive diagrams
----------------------------

The original ESP32-S3 DevKitC view remains a combined fixed-function and
GPIO-matrix example:

.. board-pinout:: esp32s3_devkitc
   :face: top

Pinmux archetype gallery
------------------------

Each view below is a separate board/SoC pair. Open a sample page for its
source YAML and the full-size interactive view.

BeagleBone AI-64 — dense fixed per-pad modes
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The J721E sample places all 92 P8/P9 contacts on the front-facing BeagleBone
AI-64 photograph. Every header pad carries its fixed MODE 0-14 functions, with
the Zephyr UART2 console and I2C6 assignments marked.

.. board-pinout:: beaglebone_ai64_fixed_mux
   :face: top


.. board-pinout:: beagley_ai_j722s
   :face: top


.. toctree::
   :maxdepth: 1
   :hidden:

   example/beaglebone_ai64_fixed_mux/index
   example/mimxrt1062_alt_daisy/index
   example/stm32f103xb_remap/index
   example/npcx9m6f_signal_select/index
   example/nrf52840_psel/index
   example/pocketbeagle2_am6254/index
   example/beagley_ai_j722s/index
   example/zedboard_zynq7000/index

See the individual pages: :doc:`example/beaglebone_ai64_fixed_mux/index`,
:doc:`example/pocketbeagle2_am6254/index`,
:doc:`example/beagley_ai_j722s/index`,

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
