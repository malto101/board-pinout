Board Pinout
============

An interactive board pinout demo powered by the ``board_pinout`` Sphinx
extension. This page includes a real ESP32-S3 example, five pinmux archetype samples,
and three additional Zephyr board/SoC examples, using the same YAML and
underlay workflow used by consuming docs.

The archetype gallery uses five independent SoC-backed board documents. Each
sample keeps the SoC pad table separate from the board pinout so the viewer can
show inherited pad facts, mux provenance, and the hardware-specific selection
mechanism.

The five models are fixed per-pad modes (J721E), per-pad ``ALT`` plus daisy
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

The J721E sample uses the real BeagleBone AI-64 underlay and a dense 2x20
header. Fixed ``mode`` values are shown for UART2 and I2C6 alongside many
neighboring GPIO pads.

.. board-pinout:: beaglebone_ai64_fixed_mux
   :face: top

i.MX RT1062 — ALT plus peripheral daisy selection
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The LPUART3 entries demonstrate pad ``ALT`` values plus peripheral-side
``input_select`` register/value metadata.

.. board-pinout:: mimxrt1062_alt_daisy
   :face: top

STM32F1 — peripheral-wide remap
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

USART1's remap options route the same peripheral signals to PA9/PA10 or
PB6/PB7, and USART3 shows another remappable group.

.. board-pinout:: stm32f103xb_remap
   :face: top

NPCX9 — signal-owned DEVALT selection
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

UART1 candidate pads are selected by signal-owned ``SL1``/``SL2`` bits rather
than by a pad-owned alternate-function index.

.. board-pinout:: npcx9m6f_signal_select
   :face: top

nRF52840 — any-pin PSEL crossbar
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The shared ``any_pin`` rule exposes UART, I2C, SPI, and PWM candidates on the
selected GPIO pads; analog and NFC pads remain fixed functions.

.. board-pinout:: nrf52840_psel
   :face: top

Real Zephyr board examples
~~~~~~~~~~~~~~~~~~~~~~~~~~

These examples pair board artwork with separate SoC tables: PocketBeagle 2
uses the AM6254 A1 pad subset, BeagleY-AI uses J722S/AM67A, and ZedBoard uses
the XC7Z020 Zynq-7000 PS MIO subset.

.. board-pinout:: pocketbeagle2_am6254
   :face: top

.. board-pinout:: beagley_ai_j722s
   :face: top

.. board-pinout:: zedboard_zynq7000
   :face: top

The gallery pages are also listed in the navigation below so each dense view
can be opened on its own.

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
:doc:`example/mimxrt1062_alt_daisy/index`,
:doc:`example/stm32f103xb_remap/index`,
:doc:`example/npcx9m6f_signal_select/index`,
:doc:`example/nrf52840_psel/index`, :doc:`example/pocketbeagle2_am6254/index`,
:doc:`example/beagley_ai_j722s/index`, and
:doc:`example/zedboard_zynq7000/index`.

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
