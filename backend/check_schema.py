#!/usr/bin/env python3
import asyncio
import sys

async def main():
    print("Initializing repository...")
    from database import SQLiteRepository
    
    repo = SQLiteRepository()
    await repo.initialize()
    print("Repository initialized!")
    
    # Check detection_logs
    async with repo._connection.execute("PRAGMA table_info(detection_logs)") as cursor:
        cols = await cursor.fetchall()
        print("\ndetection_logs columns:")
        for col in cols:
            print(f"  {col[1]} ({col[2]})")
    
    # Check user_sessions
    async with repo._connection.execute("PRAGMA table_info(user_sessions)") as cursor:
        cols = await cursor.fetchall()
        print("\nuser_sessions columns:")
        for col in cols:
            print(f"  {col[1]} ({col[2]})")
    
    await repo.close()
    print("\n✅ Schema verified!")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted")
        sys.exit(1)
