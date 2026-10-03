# Road snapshots

`levski.json` and `veliko-tarnovo.json` contain subsets of OpenStreetMap drivable street geometry around the named Bulgarian towns. It does not contain customer or driver locations.

© OpenStreetMap contributors. Database available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright). Retain these notices and the file metadata when redistributing this database or adapting it under ODbL.

The JSON records the source data timestamp, bounding box and license. Extracted once for development from the main Overpass instance; the deployed app serves this small file itself. There are no runtime calls to that instance. Other Bulgarian areas use the authenticated cached Private.coffee service.

To refresh: obtain a licensed OSM extract for the recorded bbox, select motorized drivable highway types and exclude access=private/no. Preserve full way geometry as arrays of latitude/longitude pairs and oneway=1/-1/0. Retain source metadata and attribution. Review direction rules, byte size and RoadNetwork tests before publishing. Coordinates must remain real OSM geometry; do not manually reshape a road to suit a GPS observation.
