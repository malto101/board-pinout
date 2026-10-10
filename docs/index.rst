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
controls above, or run the editor to author a board visually.

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
