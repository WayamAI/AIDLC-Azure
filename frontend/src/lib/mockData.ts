export const mockTestCases = {
  functional: [
    { id: "TC-001", name: "Engine Health Data Transmission", description: "Verify truck sends engine health data to fleet platform every 30 seconds", severity: "Critical", expected: "Data received by fleet platform within 30-second intervals" },
    { id: "TC-002", name: "Data Payload Validation", description: "Validate the structure and content of engine health data payload", severity: "High", expected: "Payload contains all required fields: RPM, temperature, oil pressure, fuel level" },
    { id: "TC-003", name: "Platform Acknowledgment", description: "Verify fleet platform sends acknowledgment after receiving data", severity: "High", expected: "ACK response received within 2 seconds" },
    { id: "TC-004", name: "Data Persistence", description: "Confirm received engine health data is stored in the database", severity: "Critical", expected: "Data persisted with correct timestamp and vehicle ID" },
  ],
  edge: [
    { id: "TC-010", name: "Network Interruption Recovery", description: "Verify data transmission resumes after network interruption", severity: "Critical", expected: "Queued data sent once connection is restored" },
    { id: "TC-011", name: "Rapid Engine State Changes", description: "Test behavior during rapid engine start/stop cycles", severity: "High", expected: "All state transitions captured without data loss" },
    { id: "TC-012", name: "Maximum Payload Size", description: "Send engine data exceeding expected payload size", severity: "Medium", expected: "System handles oversized payload gracefully" },
  ],
  api: [
    { id: "TC-020", name: "API Rate Limiting", description: "Verify API handles requests exceeding rate limits", severity: "High", expected: "HTTP 429 returned with retry-after header" },
    { id: "TC-021", name: "Authentication Token Expiry", description: "Test API behavior with expired authentication token", severity: "Critical", expected: "HTTP 401 returned, token refresh triggered" },
    { id: "TC-022", name: "Concurrent API Requests", description: "Test multiple trucks sending data simultaneously", severity: "High", expected: "All requests processed without data corruption" },
  ],
  failure: [
    { id: "TC-030", name: "Database Connection Failure", description: "Test system behavior when database is unreachable", severity: "Critical", expected: "Data buffered locally, alert sent to monitoring" },
    { id: "TC-031", name: "Invalid Sensor Data", description: "Send corrupted or out-of-range sensor values", severity: "High", expected: "Data flagged as invalid, not stored as valid reading" },
  ],
  regression: [
    { id: "TC-040", name: "Backward Compatibility", description: "Verify older truck firmware can still send data", severity: "High", expected: "Legacy format data accepted and processed correctly" },
    { id: "TC-041", name: "Migration Data Integrity", description: "Validate data integrity after schema migration", severity: "Critical", expected: "All historical data accessible and accurate" },
  ],
};

export const mockSyntheticData = Array.from({ length: 20 }, (_, i) => ({
  vehicleId: `TRK-${String(1000 + i).padStart(4, "0")}`,
  lat: (34.0522 + (Math.random() - 0.5) * 2).toFixed(6),
  lng: (-118.2437 + (Math.random() - 0.5) * 2).toFixed(6),
  engineTemp: Math.floor(180 + Math.random() * 60),
  rpm: Math.floor(600 + Math.random() * 3400),
  fuelLevel: Math.floor(10 + Math.random() * 90),
  oilPressure: Math.floor(25 + Math.random() * 55),
  speed: Math.floor(Math.random() * 75),
  timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
  tripId: `TRIP-${String(5000 + Math.floor(Math.random() * 1000))}`,
  status: ["Active", "Idle", "Maintenance"][Math.floor(Math.random() * 3)] as "Active" | "Idle" | "Maintenance",
}));

export const mockTestResults = [
  { id: "TC-001", name: "Engine Health Data Transmission", status: "PASS" as const, duration: 1.2, timestamp: "2026-03-09T10:15:00Z" },
  { id: "TC-002", name: "Data Payload Validation", status: "PASS" as const, duration: 0.8, timestamp: "2026-03-09T10:15:02Z" },
  { id: "TC-003", name: "Platform Acknowledgment", status: "FAIL" as const, duration: 2.1, timestamp: "2026-03-09T10:15:04Z" },
  { id: "TC-010", name: "Network Interruption Recovery", status: "PASS" as const, duration: 5.4, timestamp: "2026-03-09T10:15:10Z" },
  { id: "TC-011", name: "Rapid Engine State Changes", status: "FAIL" as const, duration: 3.2, timestamp: "2026-03-09T10:15:14Z" },
  { id: "TC-020", name: "API Rate Limiting", status: "PASS" as const, duration: 1.5, timestamp: "2026-03-09T10:15:16Z" },
  { id: "TC-021", name: "Authentication Token Expiry", status: "PASS" as const, duration: 1.1, timestamp: "2026-03-09T10:15:18Z" },
  { id: "TC-022", name: "Concurrent API Requests", status: "FAIL" as const, duration: 8.3, timestamp: "2026-03-09T10:15:27Z" },
  { id: "TC-030", name: "Database Connection Failure", status: "PASS" as const, duration: 4.2, timestamp: "2026-03-09T10:15:32Z" },
  { id: "TC-031", name: "Invalid Sensor Data", status: "PASS" as const, duration: 0.9, timestamp: "2026-03-09T10:15:33Z" },
  { id: "TC-040", name: "Backward Compatibility", status: "PASS" as const, duration: 2.3, timestamp: "2026-03-09T10:15:36Z" },
  { id: "TC-041", name: "Migration Data Integrity", status: "FAIL" as const, duration: 6.7, timestamp: "2026-03-09T10:15:43Z" },
];

export const mockPrioritizedTests = [
  { id: "TC-003", name: "Platform Acknowledgment", failureCount: 12, severity: "High", priority: 95, status: "failed" as const, knownFailure: true },
  { id: "TC-022", name: "Concurrent API Requests", failureCount: 8, severity: "Critical", priority: 92, status: "failed" as const, knownFailure: true },
  { id: "TC-041", name: "Migration Data Integrity", failureCount: 6, severity: "Critical", priority: 88, status: "failed" as const, knownFailure: false },
  { id: "TC-011", name: "Rapid Engine State Changes", failureCount: 4, severity: "High", priority: 75, status: "failed" as const, knownFailure: false },
  { id: "TC-010", name: "Network Interruption Recovery", failureCount: 2, severity: "Critical", priority: 60, status: "warning" as const, knownFailure: false },
  { id: "TC-031", name: "Invalid Sensor Data", failureCount: 1, severity: "Medium", priority: 45, status: "warning" as const, knownFailure: false },
  { id: "TC-001", name: "Engine Health Data Transmission", failureCount: 0, severity: "Critical", priority: 30, status: "stable" as const, knownFailure: false },
  { id: "TC-002", name: "Data Payload Validation", failureCount: 0, severity: "High", priority: 25, status: "stable" as const, knownFailure: false },
  { id: "TC-020", name: "API Rate Limiting", failureCount: 0, severity: "High", priority: 20, status: "stable" as const, knownFailure: false },
  { id: "TC-040", name: "Backward Compatibility", failureCount: 0, severity: "High", priority: 15, status: "stable" as const, knownFailure: false },
];
