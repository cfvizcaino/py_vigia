/// API timestamps are UTC. Older SQLite deployments omit the offset, and
/// `DateTime.parse` would then read them as the phone's local time.
DateTime parseApiDate(String value) {
  final parsed = DateTime.parse(value);
  if (parsed.isUtc) return parsed;
  return DateTime.utc(
    parsed.year,
    parsed.month,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
    parsed.millisecond,
    parsed.microsecond,
  );
}

class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.role,
  });

  final String id;
  final String email;
  final String displayName;
  final String role;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
    id: json['id'] as String,
    email: json['email'] as String,
    displayName: json['display_name'] as String,
    role: json['role'] as String,
  );
}

class Device {
  const Device({
    required this.id,
    required this.externalId,
    required this.name,
    required this.kind,
    required this.status,
    required this.lat,
    required this.lng,
    this.cameraModel,
  });

  final String id;
  final String externalId;
  final String name;
  final String kind;
  final String status;
  final double lat;
  final double lng;
  final String? cameraModel;

  factory Device.fromJson(Map<String, dynamic> json) => Device(
    id: json['id'] as String,
    externalId: json['external_id'] as String,
    name: json['name'] as String,
    kind: json['kind'] as String,
    status: json['status'] as String,
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
    cameraModel: json['camera_model'] as String?,
  );
}

class NearbyDevice {
  const NearbyDevice({
    required this.id,
    required this.externalId,
    required this.name,
    required this.lat,
    required this.lng,
    required this.distanceM,
  });

  final String id;
  final String externalId;
  final String name;
  final double lat;
  final double lng;
  final double distanceM;

  factory NearbyDevice.fromJson(Map<String, dynamic> json) => NearbyDevice(
    id: json['id'] as String,
    externalId: json['external_id'] as String,
    name: json['name'] as String,
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
    distanceM: (json['distance_m'] as num?)?.toDouble() ?? 0,
  );
}

class QueryInput {
  const QueryInput({
    required this.lat,
    required this.lng,
    required this.radiusM,
    required this.timeFrom,
    required this.timeTo,
    this.vehicleType,
    this.color,
  });

  final double lat;
  final double lng;
  final int radiusM;
  final DateTime timeFrom;
  final DateTime timeTo;
  final String? vehicleType;
  final String? color;

  Map<String, String> toQueryParameters() {
    final parameters = <String, String>{
      'lat': '$lat',
      'lng': '$lng',
      'radius_m': '$radiusM',
      'time_from': timeFrom.toUtc().toIso8601String(),
      'time_to': timeTo.toUtc().toIso8601String(),
    };
    if (vehicleType != null) parameters['vehicle_type'] = vehicleType!;
    if (color != null && color!.isNotEmpty) parameters['color'] = color!;
    return parameters;
  }

  factory QueryInput.fromJson(Map<String, dynamic> json) => QueryInput(
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
    radiusM: (json['radius_m'] as num).toInt(),
    timeFrom: parseApiDate(json['time_from'] as String),
    timeTo: parseApiDate(json['time_to'] as String),
    vehicleType: json['vehicle_type'] as String?,
    color: json['color'] as String?,
  );
}

class RouteDetection {
  const RouteDetection({
    required this.sequenceOrder,
    required this.detectionId,
    required this.cameraId,
    required this.vehicleType,
    required this.direction,
    required this.confidence,
    required this.observedAt,
    this.color,
  });

  final int sequenceOrder;
  final String detectionId;
  final String cameraId;
  final String vehicleType;
  final String? color;
  final String direction;
  final double confidence;
  final DateTime observedAt;

  factory RouteDetection.fromJson(Map<String, dynamic> json) => RouteDetection(
    sequenceOrder: (json['sequence_order'] as num).toInt(),
    detectionId: json['detection_id'] as String,
    cameraId: json['camera_id'] as String,
    vehicleType: json['vehicle_type'] as String,
    color: json['color'] as String?,
    direction: json['direction'] as String,
    confidence: (json['confidence'] as num).toDouble(),
    observedAt: parseApiDate(json['observed_at'] as String),
  );
}

class RoadPoint {
  const RoadPoint({required this.lat, required this.lng});

  final double lat;
  final double lng;

  factory RoadPoint.fromJson(Map<String, dynamic> json) => RoadPoint(
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
  );
}

class CandidateRoute {
  const CandidateRoute({
    required this.id,
    required this.rank,
    required this.confidence,
    required this.hasDistantGaps,
    required this.cameraIds,
    required this.vehicleType,
    required this.detections,
    required this.explanation,
    this.color,
    this.roadGeometry,
  });

  final String id;
  final int rank;
  final double confidence;
  final bool hasDistantGaps;
  final List<String> cameraIds;
  final String vehicleType;
  final String? color;
  final List<RouteDetection> detections;
  final Map<String, dynamic> explanation;
  final Map<String, dynamic>? roadGeometry;

  List<RoadPoint> get roadPoints {
    final points = roadGeometry?['points'];
    if (points is! List) return const [];
    return points
        .whereType<Map<String, dynamic>>()
        .map(RoadPoint.fromJson)
        .toList(growable: false);
  }

  factory CandidateRoute.fromJson(Map<String, dynamic> json) => CandidateRoute(
    id: json['id'] as String,
    rank: (json['rank'] as num).toInt(),
    confidence: (json['confidence'] as num).toDouble(),
    hasDistantGaps: json['has_distant_gaps'] as bool,
    cameraIds: (json['camera_ids'] as List).cast<String>(),
    vehicleType: json['vehicle_type'] as String,
    color: json['color'] as String?,
    detections: (json['detections'] as List)
        .map((item) => RouteDetection.fromJson(item as Map<String, dynamic>))
        .toList(growable: false),
    explanation: Map<String, dynamic>.from(
      json['explanation'] as Map? ?? const {},
    ),
    roadGeometry: json['road_geometry'] == null
        ? null
        : Map<String, dynamic>.from(json['road_geometry'] as Map),
  );
}

class QueryRecord {
  const QueryRecord({
    required this.id,
    required this.input,
    required this.createdAt,
  });

  final String id;
  final QueryInput input;
  final DateTime createdAt;

  factory QueryRecord.fromJson(Map<String, dynamic> json) => QueryRecord(
    id: json['id'] as String,
    input: QueryInput.fromJson(json),
    createdAt: parseApiDate(json['created_at'] as String),
  );
}

class QueryResult {
  const QueryResult({
    required this.query,
    required this.nearbyDevices,
    required this.candidateDetectionCount,
    required this.routes,
  });

  final QueryRecord query;
  final List<NearbyDevice> nearbyDevices;
  final int candidateDetectionCount;
  final List<CandidateRoute> routes;

  factory QueryResult.fromJson(Map<String, dynamic> json) => QueryResult(
    query: QueryRecord.fromJson(json['query'] as Map<String, dynamic>),
    nearbyDevices: (json['nearby_devices'] as List)
        .map((item) => NearbyDevice.fromJson(item as Map<String, dynamic>))
        .toList(growable: false),
    candidateDetectionCount: (json['candidate_detection_count'] as num).toInt(),
    routes: (json['routes'] as List)
        .map((item) => CandidateRoute.fromJson(item as Map<String, dynamic>))
        .toList(growable: false),
  );
}

/// A case of the synthetic scoring dataset (`GET /api/v1/scenarios`).
/// Date and times are Colombian local time, ready for the query form.
class Scenario {
  const Scenario({
    required this.id,
    required this.title,
    required this.cameraId,
    required this.radiusM,
    required this.date,
    required this.timeFrom,
    required this.timeTo,
    this.vehicleType,
    this.color,
  });

  final String id;
  final String title;
  final String cameraId;
  final int radiusM;
  final String date;
  final String timeFrom;
  final String timeTo;
  final String? vehicleType;
  final String? color;

  DateTime get from => _bogotaToUtc(date, timeFrom);
  DateTime get to => _bogotaToUtc(date, timeTo);

  factory Scenario.fromJson(Map<String, dynamic> json) => Scenario(
    id: json['id'] as String,
    title: json['title'] as String,
    cameraId: json['camera_id'] as String,
    radiusM: (json['radius_m'] as num).round(),
    date: json['date'] as String,
    timeFrom: json['time_from'] as String,
    timeTo: json['time_to'] as String,
    vehicleType: json['vehicle_type'] as String?,
    color: json['color'] as String?,
  );
}

DateTime _bogotaToUtc(String date, String time) {
  final day = DateTime.parse(date);
  final [hour, minute] = time.split(':').map(int.parse).toList();
  // Colombia has no daylight saving: always UTC−5.
  return DateTime.utc(day.year, day.month, day.day, hour + 5, minute);
}
