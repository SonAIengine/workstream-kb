# Knowledge Base Item Classification

Classify each item in the JSON array below into the appropriate project, and provide a summary.

## Project List
{PROJECTS}

## Classification Rules
1. Determine the project based on subject, body preview, and sender domain/keywords
2. If unsure, classify as _general
3. One item belongs to one primary project only

## Response Format (JSON)
Respond with a JSON array in this exact format:
```json
[
  {
    "id": "original id",
    "project": "project name from list above",
    "title": "concise title",
    "summary": "2-3 sentence summary",
    "tags": ["tag1", "tag2"],
    "importance": "high|medium|low"
  }
]
```

## Input Data
{INPUT}
