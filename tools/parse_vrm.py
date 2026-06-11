import struct
import json
import sys

filepath = sys.argv[1]

with open(filepath, 'rb') as f:
    magic = f.read(4)
    if magic != b'glTF':
        print("Not a glTF file")
        sys.exit(1)
    
    version = struct.unpack('<I', f.read(4))[0]
    length = struct.unpack('<I', f.read(4))[0]
    
    # Read chunk 0
    chunk0_length = struct.unpack('<I', f.read(4))[0]
    chunk0_type = f.read(4)
    if chunk0_type != b'JSON':
        print("Chunk 0 is not JSON")
        sys.exit(1)
    
    chunk0_data = f.read(chunk0_length)
    json_data = json.loads(chunk0_data.decode('utf-8'))
    
    with open('output/vrm_data.json', 'w', encoding='utf-8') as out:
        json.dump(json_data, out, ensure_ascii=False, indent=2)

print("Saved JSON data to output/vrm_data.json")
