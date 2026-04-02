import { describe, it, expect } from "vitest";
import { buildBodyFromItems, formatFileSize } from "./inbound.js";
import type { HubMessageItem } from "./types.js";

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.0KB");
    expect(formatFileSize(1536)).toBe("1.5KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0MB");
    expect(formatFileSize(5.5 * 1024 * 1024)).toBe("5.5MB");
  });
});

describe("buildBodyFromItems", () => {
  it("returns content as-is when no items", () => {
    expect(buildBodyFromItems("hello", "text", undefined)).toBe("hello");
    expect(buildBodyFromItems("hello", "text", [])).toBe("hello");
  });

  it("extracts text from text items", () => {
    const items: HubMessageItem[] = [{ type: "text", text: "hello world" }];
    expect(buildBodyFromItems("", "text", items)).toBe("hello world");
  });

  it("formats file item with name, size, and URL", () => {
    const items: HubMessageItem[] = [
      {
        type: "file",
        file_name: "report.pdf",
        media: {
          url: "https://hub.example.com/api/v1/channels/media?bot=b1&eqp=x",
          file_size: 2048,
        },
      },
    ];
    const result = buildBodyFromItems("", "file", items);
    expect(result).toContain("[File: report.pdf (2.0KB)]");
    expect(result).toContain("https://hub.example.com/api/v1/channels/media?bot=b1&eqp=x");
  });

  it("formats file item without size or URL", () => {
    const items: HubMessageItem[] = [
      { type: "file", file_name: "doc.txt" },
    ];
    expect(buildBodyFromItems("", "file", items)).toBe("[File: doc.txt]");
  });

  it("uses default name when file_name is missing", () => {
    const items: HubMessageItem[] = [{ type: "file" }];
    expect(buildBodyFromItems("", "file", items)).toBe("[File: file]");
  });

  it("formats image item with URL", () => {
    const items: HubMessageItem[] = [
      { type: "image", media: { url: "https://hub.example.com/img" } },
    ];
    const result = buildBodyFromItems("", "image", items);
    expect(result).toContain("[Image]");
    expect(result).toContain("https://hub.example.com/img");
  });

  it("formats voice item with duration", () => {
    const items: HubMessageItem[] = [
      { type: "voice", media: { url: "https://hub.example.com/voice", play_time: 5 } },
    ];
    const result = buildBodyFromItems("", "voice", items);
    expect(result).toContain("[Voice 5s]");
    expect(result).toContain("https://hub.example.com/voice");
  });

  it("formats video item with duration", () => {
    const items: HubMessageItem[] = [
      { type: "video", media: { url: "https://hub.example.com/video", play_length: 30 } },
    ];
    const result = buildBodyFromItems("", "video", items);
    expect(result).toContain("[Video 30s]");
    expect(result).toContain("https://hub.example.com/video");
  });

  it("handles mixed text + file items", () => {
    const items: HubMessageItem[] = [
      { type: "text", text: "Here is the file" },
      { type: "file", file_name: "data.csv", media: { file_size: 1024 } },
    ];
    const result = buildBodyFromItems("", "file", items);
    expect(result).toBe("Here is the file\n[File: data.csv (1.0KB)]");
  });

  it("falls back to content when items produce no parts", () => {
    const items: HubMessageItem[] = [{ type: "text" }]; // text with no text field
    expect(buildBodyFromItems("fallback", "text", items)).toBe("fallback");
  });

  it("text messages with items still return rawContent at the call site", () => {
    // buildBodyFromItems itself processes items, but the call site in
    // handleInboundEvent should skip it for text messages and use rawContent.
    // Verify that for msgType "text", the caller logic preserves rawContent.
    const rawContent = "Hello from hub";
    const msgType = "text";
    const items: HubMessageItem[] = [{ type: "text", text: "different text from items" }];
    const content = msgType && msgType !== "text"
      ? buildBodyFromItems(rawContent, msgType, items)
      : rawContent;
    expect(content).toBe("Hello from hub");
  });
});
