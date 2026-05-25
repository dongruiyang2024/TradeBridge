import argparse
import struct
from pathlib import Path


def read_c_string(data: bytes, offset: int) -> str:
    end = data.find(b"\x00", offset)
    if end < 0:
        end = len(data)
    return data[offset:end].decode("utf-8", "replace")


def parse_exports(path: Path) -> list[str]:
    data = path.read_bytes()
    if data[:2] != b"MZ":
        raise ValueError("not a PE file")
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_offset:pe_offset + 4] != b"PE\x00\x00":
        raise ValueError("missing PE signature")

    coff_offset = pe_offset + 4
    machine, section_count, _, _, _, opt_size, _ = struct.unpack_from("<HHIIIHH", data, coff_offset)
    optional_offset = coff_offset + 20
    magic = struct.unpack_from("<H", data, optional_offset)[0]
    if magic == 0x20B:
        data_directory_offset = optional_offset + 112
    elif magic == 0x10B:
        data_directory_offset = optional_offset + 96
    else:
        raise ValueError(f"unknown optional header magic {magic:x}")

    export_rva, export_size = struct.unpack_from("<II", data, data_directory_offset)
    section_offset = optional_offset + opt_size
    sections = []
    for idx in range(section_count):
        off = section_offset + idx * 40
        name = data[off:off + 8].split(b"\x00", 1)[0].decode("ascii", "replace")
        virtual_size, virtual_address, raw_size, raw_pointer = struct.unpack_from("<IIII", data, off + 8)
        sections.append((name, virtual_address, max(virtual_size, raw_size), raw_pointer, raw_size))

    def rva_to_offset(rva: int) -> int:
        for _, virtual_address, virtual_size, raw_pointer, raw_size in sections:
            if virtual_address <= rva < virtual_address + virtual_size:
                delta = rva - virtual_address
                if delta >= raw_size and raw_size != 0:
                    break
                return raw_pointer + delta
        raise ValueError(f"RVA {rva:x} not mapped")

    if not export_rva or not export_size:
        return []

    export_offset = rva_to_offset(export_rva)
    fields = struct.unpack_from("<IIHHIIIIIII", data, export_offset)
    _, _, _, _, name_rva, base, function_count, name_count, functions_rva, names_rva, ordinals_rva = fields

    exports = []
    for idx in range(name_count):
        name_rva_i = struct.unpack_from("<I", data, rva_to_offset(names_rva) + idx * 4)[0]
        exports.append(read_c_string(data, rva_to_offset(name_rva_i)))
    return sorted(exports)


def main() -> int:
    parser = argparse.ArgumentParser(description="List PE export names.")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--filter", default="")
    args = parser.parse_args()

    needle = args.filter.lower()
    for raw_path in args.paths:
        path = Path(raw_path)
        try:
            exports = parse_exports(path)
        except Exception as exc:
            print(f"{path}: ERR {type(exc).__name__}: {exc}")
            continue

        if needle:
            exports = [item for item in exports if needle in item.lower()]
        print(f"{path}: exports={len(exports)}")
        for item in exports:
            print(f"  {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
