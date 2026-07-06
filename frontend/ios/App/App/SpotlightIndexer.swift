import Foundation
import CoreSpotlight
import UniformTypeIdentifiers

/// Indexes the bundled EU medicine catalogue into CoreSpotlight so drugs are
/// findable from the iOS system search. Runs off the main thread; re-indexes
/// only when the bundled data's `generated` stamp changes (tracked in
/// UserDefaults). Tapping a result is handled in AppDelegate, which hands the
/// drug name to the web app via a Preferences key.
enum SpotlightIndexer {
    static let domain = "drugs"
    static let idPrefix = "drug::"
    private static let markerKey = "dr_spotlight_indexed_generated"

    static func indexIfNeeded() {
        DispatchQueue.global(qos: .utility).async {
            guard let url = Bundle.main.url(
                forResource: "ema-medicines", withExtension: "json", subdirectory: "public/data"
            ), let data = try? Data(contentsOf: url),
                let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let authorised = root["authorised"] as? [[String: Any]]
            else { return }

            let generated = root["generated"] as? String ?? ""
            if UserDefaults.standard.string(forKey: markerKey) == generated, !generated.isEmpty {
                return // already indexed this data snapshot
            }

            var items: [CSSearchableItem] = []
            items.reserveCapacity(authorised.count)
            for med in authorised {
                guard let name = med["n"] as? String, !name.isEmpty else { continue }
                let inn = med["inn"] as? String ?? ""
                let area = med["area"] as? String ?? ""

                let attrs = CSSearchableItemAttributeSet(contentType: .text)
                attrs.title = name
                attrs.contentDescription = [inn, area.replacingOccurrences(of: ";", with: ", ")]
                    .filter { !$0.isEmpty }
                    .joined(separator: " — ")
                var keywords = [name]
                if !inn.isEmpty { keywords.append(inn) }
                keywords.append(contentsOf: area.split(separator: ";").map {
                    $0.trimmingCharacters(in: .whitespaces)
                })
                attrs.keywords = keywords

                items.append(CSSearchableItem(
                    uniqueIdentifier: idPrefix + name,
                    domainIdentifier: domain,
                    attributeSet: attrs
                ))
            }

            let index = CSSearchableIndex.default()
            index.deleteSearchableItems(withDomainIdentifiers: [domain]) { _ in
                index.indexSearchableItems(items) { error in
                    if error == nil {
                        UserDefaults.standard.set(generated, forKey: markerKey)
                    }
                }
            }
        }
    }
}
