import Foundation
import SwiftData

@Model
final class SermonDraft {
    var liturgicalDate: Date
    var title: String
    var mainReadingReference: String?
    var mainReadingSlot: String?
    var modifiedAt: Date
    @Attribute(.externalStorage) var rtfData: Data?

    init(liturgicalDate: Date) {
        self.liturgicalDate = Calendar.current.startOfDay(for: liturgicalDate)
        self.title = ""
        self.mainReadingReference = nil
        self.mainReadingSlot = nil
        self.modifiedAt = .now
        self.rtfData = nil
    }
}
