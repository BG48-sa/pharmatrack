import WidgetKit
import SwiftUI

// Shared App Group between the app and this widget.
// The app (AppDelegate) mirrors the Capacitor Preferences key
// `dr_widget_snapshot` into this suite under `widget_snapshot`.
let appGroupId = "group.com.berndgansbacher.pharmatrack"
let snapshotKey = "widget_snapshot"

// MARK: - Snapshot model (written by the web app as JSON)

struct DecisionItem: Codable, Identifiable {
    let drug: String
    let indication: String
    let date: String  // ISO yyyy-MM-dd (estimated EU EC decision date)

    var id: String { drug + date }

    var parsedDate: Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.date(from: date)
    }
}

struct WidgetSnapshot: Codable {
    let updated: String?
    let items: [DecisionItem]
}

func loadSnapshot() -> WidgetSnapshot? {
    guard let defaults = UserDefaults(suiteName: appGroupId),
          let raw = defaults.string(forKey: snapshotKey),
          let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
}

// MARK: - Timeline

struct DecisionsEntry: TimelineEntry {
    let date: Date
    let items: [DecisionItem]
    let hasData: Bool
}

struct DecisionsProvider: TimelineProvider {
    func placeholder(in context: Context) -> DecisionsEntry {
        DecisionsEntry(
            date: Date(),
            items: [
                DecisionItem(drug: "Etcamah", indication: "Multiple myeloma", date: "2026-07-27"),
                DecisionItem(drug: "Camizestrant", indication: "Breast cancer", date: "2026-08-14"),
            ],
            hasData: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (DecisionsEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DecisionsEntry>) -> Void) {
        // Refresh daily; the app also forces a reload whenever it mirrors new data.
        let next = Calendar.current.date(byAdding: .hour, value: 24, to: Date()) ?? Date().addingTimeInterval(86400)
        completion(Timeline(entries: [currentEntry()], policy: .after(next)))
    }

    private func currentEntry() -> DecisionsEntry {
        guard let snap = loadSnapshot() else {
            return DecisionsEntry(date: Date(), items: [], hasData: false)
        }
        // Upcoming only, soonest first.
        let today = Calendar.current.startOfDay(for: Date())
        let upcoming = snap.items
            .filter { ($0.parsedDate ?? .distantPast) >= today }
            .sorted { ($0.parsedDate ?? .distantFuture) < ($1.parsedDate ?? .distantFuture) }
        return DecisionsEntry(date: Date(), items: upcoming, hasData: true)
    }
}

// MARK: - Views

extension View {
    @ViewBuilder func widgetBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(.background, for: .widget)
        } else {
            background(Color(UIColor.systemBackground))
        }
    }
}

struct ItemRow: View {
    let item: DecisionItem
    let compact: Bool

    var dateLabel: String {
        guard let d = item.parsedDate else { return item.date }
        let f = DateFormatter()
        f.dateFormat = compact ? "d MMM" : "d MMM yyyy"
        return f.string(from: d)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack {
                Text(item.drug)
                    .font(compact ? .caption : .callout)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text("~\(dateLabel)")
                    .font(compact ? .caption2 : .caption)
                    .foregroundColor(.secondary)
            }
            Text(item.indication)
                .font(.caption2)
                .foregroundColor(.secondary)
                .lineLimit(1)
        }
    }
}

struct DecisionsWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: DecisionsEntry

    var maxItems: Int {
        switch family {
        case .systemSmall: return 1
        case .systemMedium: return 2
        default: return 5
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "pills.fill")
                    .font(.caption2)
                    .foregroundColor(.blue)
                Text("EU decisions")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.blue)
                Spacer()
            }
            if !entry.hasData {
                Text("Open DrugRadar and follow an indication to see upcoming EU decisions.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            } else if entry.items.isEmpty {
                Text("No upcoming decisions for your followed indications.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            } else {
                ForEach(entry.items.prefix(maxItems)) { item in
                    ItemRow(item: item, compact: family == .systemSmall)
                }
            }
            Spacer(minLength: 0)
            Text("Estimated dates — verify officially")
                .font(.system(size: 8))
                .foregroundColor(.secondary.opacity(0.7))
        }
        .padding(family == .systemSmall ? 12 : 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetBackground()
    }
}

// MARK: - Widget definition

struct DrugRadarWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DrugRadarDecisions", provider: DecisionsProvider()) { entry in
            DecisionsWidgetView(entry: entry)
        }
        .configurationDisplayName("Upcoming EU decisions")
        .description("Estimated EU decision dates for drugs matching your followed indications.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct DrugRadarWidgetBundle: WidgetBundle {
    var body: some Widget {
        DrugRadarWidget()
    }
}
