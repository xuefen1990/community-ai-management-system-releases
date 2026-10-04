import AppKit
import Foundation
import PDFKit
import Vision

struct OcrBlock: Codable {
    let text: String
    let confidence: Double
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OcrPage: Codable {
    let pageNumber: Int
    let text: String
    let confidence: Double
    let blocks: [OcrBlock]
}

struct OcrResult: Codable {
    let engine: String
    let pageCount: Int
    let processedPageCount: Int
    let truncated: Bool
    let pages: [OcrPage]
}

enum OcrError: LocalizedError {
    case invalidArguments
    case unreadableFile
    case unreadablePage(Int)

    var errorDescription: String? {
        switch self {
        case .invalidArguments: return "缺少需要识别的文件路径"
        case .unreadableFile: return "无法读取图片或 PDF 文件"
        case .unreadablePage(let page): return "无法读取 PDF 第 \(page) 页"
        }
    }
}

func cgImage(from image: NSImage) -> CGImage? {
    var rect = NSRect(origin: .zero, size: image.size)
    return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func pageImage(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let longest = max(bounds.width, bounds.height)
    let scale = longest > 0 ? min(2_400 / longest, 3.0) : 1.0
    let size = NSSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    return cgImage(from: page.thumbnail(of: size, for: .mediaBox))
}

func recognize(_ image: CGImage, pageNumber: Int) throws -> OcrPage {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.minimumTextHeight = 0.006
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let observations = (request.results ?? []).sorted {
        let rowDifference = abs($0.boundingBox.midY - $1.boundingBox.midY)
        if rowDifference > 0.02 { return $0.boundingBox.midY > $1.boundingBox.midY }
        return $0.boundingBox.minX < $1.boundingBox.minX
    }
    let blocks = observations.compactMap { observation -> OcrBlock? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return OcrBlock(
            text: candidate.string,
            confidence: Double(candidate.confidence),
            x: box.minX,
            y: box.minY,
            width: box.width,
            height: box.height
        )
    }
    let confidence = blocks.isEmpty ? 0 : blocks.reduce(0) { $0 + $1.confidence } / Double(blocks.count)
    return OcrPage(pageNumber: pageNumber, text: blocks.map(\.text).joined(separator: "\n"), confidence: confidence, blocks: blocks)
}

func readablePdfText(_ page: PDFPage, pageNumber: Int) -> OcrPage? {
    guard let raw = page.string else { return nil }
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.count >= 8 else { return nil }
    let block = OcrBlock(text: value, confidence: 1.0, x: 0, y: 0, width: 1, height: 1)
    return OcrPage(pageNumber: pageNumber, text: value, confidence: 1.0, blocks: [block])
}

func run() throws -> OcrResult {
    guard CommandLine.arguments.count >= 2 else { throw OcrError.invalidArguments }
    let filePath = CommandLine.arguments[1]
    let maximumPages = max(1, min(Int(CommandLine.arguments.dropFirst(2).first ?? "30") ?? 30, 100))
    let fileUrl = URL(fileURLWithPath: filePath)
    if fileUrl.pathExtension.lowercased() == "pdf" {
        guard let document = PDFDocument(url: fileUrl) else { throw OcrError.unreadableFile }
        let processedCount = min(document.pageCount, maximumPages)
        var pages: [OcrPage] = []
        var textPageCount = 0
        for index in 0..<processedCount {
            guard let page = document.page(at: index) else {
                throw OcrError.unreadablePage(index + 1)
            }
            if let textPage = readablePdfText(page, pageNumber: index + 1) {
                pages.append(textPage)
                textPageCount += 1
            } else {
                guard let image = pageImage(page) else { throw OcrError.unreadablePage(index + 1) }
                pages.append(try recognize(image, pageNumber: index + 1))
            }
        }
        return OcrResult(
            engine: textPageCount == processedCount ? "apple-pdfkit" : (textPageCount > 0 ? "apple-pdfkit-vision" : "apple-vision"),
            pageCount: document.pageCount,
            processedPageCount: processedCount,
            truncated: processedCount < document.pageCount,
            pages: pages
        )
    }
    guard let image = NSImage(contentsOf: fileUrl), let cgImage = cgImage(from: image) else {
        throw OcrError.unreadableFile
    }
    return OcrResult(
        engine: "apple-vision",
        pageCount: 1,
        processedPageCount: 1,
        truncated: false,
        pages: [try recognize(cgImage, pageNumber: 1)]
    )
}

do {
    let result = try run()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(result))
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
