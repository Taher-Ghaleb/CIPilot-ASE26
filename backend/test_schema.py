#!/usr/bin/env python3
import asyncio
from database import SQLiteRepository

async def test():
    repo = SQLiteRepository()
    await repo.initialize()
    
    async with repo._connection.execute("PRAGMA table_info(detection_logs)") as cursor:
        cols = await cursor.fetchall()
        print("detection_logs columns:")
        for col in cols:
            print(f"  {col[1]} ({col[2]})")
    
    async with repo._connection.execute("PRAGMA table_info(user_sessions)") as cursor:
        cols = await cursor.fetchall()
        print("\nuser_sessions columns:")
        for col in cols:
            print(f"  {col[1]} ({col[2]})")
    
    await repo.close()
    print("\n✅ Schema verified!")

if __name__ == "__main__":
    asyncio.run(test())
