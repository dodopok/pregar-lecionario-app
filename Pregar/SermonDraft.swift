import Foundation
import SwiftData

enum SermonDateKey {
    static func string(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

@Model
final class SermonDraft {
    var liturgicalDate: Date
    var title: String
    var liturgicalOccasion: String?
    var liturgicalCelebration: String?
    var liturgicalSeason: String?
    var prayerBookID: String?
    var mainReadingReference: String?
    var mainReadingSlot: String?
    var modifiedAt: Date
    @Attribute(.externalStorage) var rtfData: Data?

    init(liturgicalDate: Date) {
        self.liturgicalDate = Calendar.current.startOfDay(for: liturgicalDate)
        self.title = ""
        self.liturgicalOccasion = nil
        self.liturgicalCelebration = nil
        self.liturgicalSeason = nil
        self.prayerBookID = nil
        self.mainReadingReference = nil
        self.mainReadingSlot = nil
        self.modifiedAt = .now
        self.rtfData = nil
    }
}
