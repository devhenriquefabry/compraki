import sys

def count_braces(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    open_count = content.count('{')
    close_count = content.count('}')
    
    print(f"File: {filename}")
    print(f"Opening braces: {open_count}")
    print(f"Closing braces: {close_count}")
    
    if open_count != close_count:
        print("ERROR: Mismatched braces!")
        # Try to find where it might be
        stack = []
        for i, char in enumerate(content):
            if char == '{':
                stack.append(i)
            elif char == '}':
                if not stack:
                    print(f"Unexpected closing brace at index {i}")
                else:
                    stack.pop()
        
        for pos in stack:
            print(f"Unclosed opening brace at index {pos}")

if __name__ == "__main__":
    count_braces(sys.argv[1])
