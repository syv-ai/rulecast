<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Insecure deserialization

`insecure-deserialization` · anti-patterns, security

Data from outside is decoded with a format that can choose which classes to build or which code to run (pickle, Java serialization, BinaryFormatter, polymorphic JSON with type names), so crafted input can run code or build objects the program never meant to.

*Names:* Shown at scale by Chris Frohoff and Gabriel Lawrence in "Marshalling Pickles" (AppSecCali 2015) and their ysoserial tool. MITRE's CWE-502, Deserialization of Untrusted Data. A8:2017 in the OWASP Top 10, now part of A08:2025 Software or Data Integrity Failures.

*Matters most for:* distributed, event-driven, ml-training, plugin-host, web-api

## But

Native serialization is fine for data that never crosses a trust boundary: a process's own cache file, an in-memory copy, a message between two parts of the same deployment that an attacker can't write. Signed and integrity-checked blobs are acceptable even across boundaries. The risk lives in who can write the bytes, not in the library itself.

## Quality axes

- **delivery** +: Native serialization round-trips any object in one call with no schema to write.
- **security** −: Crafted bytes can run code or build objects the program never meant to create when they are decoded.

**Flips:** For data that never crosses a trust boundary, such as a process's own cache, native serialization is fine.

## Why people fall into it

- Native serialization round-trips any object with one call, with no schema to write.
- Caching, sessions and queues start inside one trusted system and later get an untrusted producer.
- Polymorphic JSON with type names solves "deserialize to the right subclass" with one setting.
- ML tooling saved models as pickles by default for years, and examples still do.

## How it shows

- pickle, joblib or torch.load on files or messages that came from users, uploads or a shared bucket.
- yaml.load with an unsafe loader, or Java ObjectInputStream.readObject on network input.
- .NET BinaryFormatter, NetDataContractSerializer or LosFormatter, or Json.NET with TypeNameHandling other than None.
- Jackson with default typing activated or @JsonTypeInfo using class names.
- Serialized objects in cookies, hidden form fields or queue messages without a signature.
- Model or plugin files from the internet loaded with a format that can execute code.

## Overcorrecting looks like

- Banning pickle or native serialization for data the process itself wrote to its own local cache, where the attacker would already need write access to the machine.
- Signing every internal message between services that already share a trusted, authenticated channel.

## What to do

Decode untrusted data only with data-only formats (JSON, protobuf, safe YAML) into explicit types, and map subtypes with an allow-list of known discriminators rather than class names. Where native serialization can't be avoided, sign the data and verify before decoding, and configure a class allow-list filter. For models, prefer weights-only formats such as safetensors.

## Example

Before:

```
route GET "/reports"
fn list_reports(request: Request) -> list[Report]:
    saved = request.cookie("report_filters")
    filters = native_deserialize(base64_decode(saved))   # may build any class
    return reports.search(filters)
```

After:

```
class ReportFilters:
    region: str
    since: Date

route GET "/reports"
fn list_reports(request: Request) -> list[Report]:
    saved = verify_signed(request.cookie("report_filters"), key=COOKIE_KEY)
    filters = json_decode(saved, into=ReportFilters)     # data only, one known type
    return reports.search(filters)
```

The cookie is checked for tampering and then decoded as plain data into one declared type, so it can't name a class to build.

## One-file tell

Written for python, java and csharp. pickle.load or pickle.loads, joblib.load, dill.load, yaml.load with Loader=yaml.Loader or UnsafeLoader, yaml.unsafe_load, torch.load with weights_only=False; ObjectInputStream readObject, activateDefaultTyping or enableDefaultTyping, @JsonTypeInfo(use = JsonTypeInfo.Id.CLASS); BinaryFormatter, NetDataContractSerializer, LosFormatter, SoapFormatter, or TypeNameHandling set to anything other than None. Calls in tests and on files the code wrote itself are false hits worth a glance, not a block.

## By language

**python:** pickle, shelve, joblib and dill execute code on load. PyYAML's safe_load is safe, load needs an explicit Loader and is unsafe with Loader or UnsafeLoader. torch.load defaults to weights_only=True since PyTorch 2.6; safetensors avoids the issue. numpy.load refuses pickles unless allow_pickle=True.

**typescript:** JSON.parse doesn't run code, but merging parsed objects deeply into existing ones can cause prototype pollution through __proto__ keys. node-serialize and eval-based decoders are unsafe. js-yaml 4's load is safe by default.

**java:** ObjectInputStream on untrusted data is the classic gadget-chain risk; JEP 290 serialization filters (ObjectInputFilter) give a class allow-list. Jackson is safe unless polymorphic typing by class name is on (activateDefaultTyping, @JsonTypeInfo with Id.CLASS). XStream and older SnakeYAML defaults are similar risks.

**csharp:** BinaryFormatter is obsolete and its implementation was removed in .NET 9; Microsoft says it can't be made safe. Keep Json.NET's TypeNameHandling at None or use a SerializationBinder allow-list. System.Text.Json only handles polymorphism through declared [JsonDerivedType] types, which is an allow-list.

**go:** encoding/json and encoding/gob build only the types the code names, so gadget chains are rare; the remaining risks are huge allocations from crafted input and trusting decoded fields without validation.

**rust:** serde builds only the declared types, so code execution through deserialization is not a practical concern; bound input sizes (bincode's limits) to avoid allocation attacks.

## Related

[Validate at the boundary](validate-at-the-boundary.md) · [Trusting client input](trusting-client-input.md) · [Defense in depth](defense-in-depth.md)

## Sources

- [OWASP Cheat Sheet Series, Deserialization (CC BY-SA 4.0)](https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html) (read)
- [OWASP Top 10 2025, A08:2025 Software or Data Integrity Failures, CWE-502 (CC BY 3.0)](https://top10.owasp.org/2025/A08_2025-Software_or_Data_Integrity_Failures/) (read)
- [Frohoff and Lawrence, Marshalling Pickles, AppSecCali 2015](https://frohoff.github.io/appseccali-marshalling-pickles/) (recalled)
- [MITRE CWE-502, Deserialization of Untrusted Data](https://cwe.mitre.org/data/definitions/502.html) (recalled)
