# Plan: Batch Sequential Events in Read Method Output

## Overview
Modify the `handleRead` function in `swarm/cli-ts/src/api.ts` to batch sequential events of the same type (especially "thinking" events with empty content) before returning them. This will reduce noise in the output and make it more useful.

## Implementation Steps

### 1. Create Event Batching Function
**File**: `swarm/cli-ts/src/api.ts` (or create a new utility file)

Create a function `batchSequentialEvents(events: any[]): any[]` that:
- Iterates through events sequentially
- Groups consecutive events that match batching criteria:
  - Same `type` (e.g., "thinking")
  - Same `agent`
  - Empty or falsy `content` (for thinking/message events)
  - `complete: false` (for thinking events)
- Replaces the group with a single batched event containing:
  - All original fields from the first event
  - A `count` field indicating how many events were batched
  - Optionally: `start_timestamp` and `end_timestamp` for the batch range
- Preserves non-batchable events as-is

**Batching criteria**:
- Batch "thinking" events when: `type === 'thinking' && (!content || content === '') && complete === false`
- Could also batch other sequential empty events in the future
- Always preserve events with content or `complete: true`

### 2. Update handleRead Function
**File**: `swarm/cli-ts/src/api.ts`

Modify the `handleRead` function (around line 237-296):
- After filtering events by priority (line 270-273), apply the batching function
- Call `batchSequentialEvents(filteredEvents)` before assigning to the result
- Update the `events` field in the return object to use the batched events

**Location**: After line 273, before line 275

```typescript
const filteredEvents = newEvents.filter(event => {
  const eventType = event.type || '';
  return criticalTypes.has(eventType) || importantTypes.has(eventType);
});

const batchedEvents = batchSequentialEvents(filteredEvents);

console.log(`[read] Agent ${agentId}: total_events=${allEvents.length}, new_events=${newEvents.length}, filtered=${filteredEvents.length}, batched=${batchedEvents.length}`);
```

### 3. Update Return Statement
**File**: `swarm/cli-ts/src/api.ts`

Change line 294 from:
```typescript
events: filteredEvents,
```
to:
```typescript
events: batchedEvents,
```

### 4. Add Tests (Optional but Recommended)
**File**: `swarm/cli-ts/tests/test_api.test.ts` (if it exists) or create new test file

Add test cases for:
- Batching sequential "thinking" events with empty content
- Preserving "thinking" events with content
- Preserving "thinking" events with `complete: true`
- Not batching events of different types
- Not batching events with different agents
- Edge cases: empty array, single event, mixed batches

## Implementation Details

### Batch Event Structure
The batched event should maintain backward compatibility:
```typescript
{
  type: 'thinking',
  agent: 'cursor',
  content: '',
  complete: false,
  count: 5,  // NEW: number of events batched
  timestamp: '2025-12-17T15:27:37.454Z',  // from first event
  end_timestamp: '2025-12-17T15:27:37.455Z'  // OPTIONAL: from last event
}
```

### Algorithm Pseudocode
```
function batchSequentialEvents(events):
  result = []
  currentBatch = null
  
  for each event in events:
    if shouldBatch(event):
      if currentBatch matches event:
        currentBatch.count++
        currentBatch.end_timestamp = event.timestamp
      else:
        if currentBatch: result.push(currentBatch)
        currentBatch = { ...event, count: 1, end_timestamp: event.timestamp }
    else:
      if currentBatch: result.push(currentBatch); currentBatch = null
      result.push(event)
  
  if currentBatch: result.push(currentBatch)
  return result
```

## Files to Modify
1. `swarm/cli-ts/src/api.ts` - Add batching function and update handleRead

## Files to Create (Optional)
1. `swarm/cli-ts/tests/test_api.test.ts` - Add tests for batching logic

## Considerations
- Backward compatibility: Batched events should still be recognizable as their original type
- Performance: Batching should be O(n) - single pass through events
- Edge cases: Handle empty arrays, single events, events at boundaries
- Future extensibility: Design batching function to be easily extended for other event types
