#!/bin/sh
set -e

# 1. 尝试获取当前 Tag，如果失败则将 current_tag 设为空，不再引发脚本崩溃
current_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

# 2. 尝试获取上一个 Tag
if [ -n "$current_tag" ]; then
	previous_tag=$(git describe --tags --abbrev=0 "$current_tag^" 2>/dev/null || echo "")
else
	previous_tag=""
fi

# 3. 根据 Tag 情况定义版本范围或直接使用 commit 范围
if [ -n "$current_tag" ] && [ -n "$previous_tag" ]; then
	version_range="$previous_tag...$current_tag"
elif [ -n "$current_tag" ]; then
	version_range="$current_tag"
else
	# 如果完全没有 Tag，默认获取最近 10 次提交，范围设为最老到最新
	first_commit=$(git rev-list --max-parents=0 HEAD | head -n 1)
	version_range="$first_commit...HEAD"
fi

if [ -n "$GITHUB_REPOSITORY" ]; then
	repo=$GITHUB_REPOSITORY
else
	repo=$(git remote get-url origin | sed \
		-e 's#.*github.com[:/]##' \
		-e 's#\.git$##')
fi

{
	echo "## What's Changed"

	# 4. 根据不同的范围类型输出日志
	if [ -n "$current_tag" ] && [ -n "$previous_tag" ]; then
		git log "$version_range" --pretty=format:"* %h %s"
	elif [ -n "$current_tag" ]; then
		git log "$current_tag" --pretty=format:"* %h %s"
	else
		# 没有 Tag 时，直接打印出本次构建涉及的最近提交
		git log -n 20 --pretty=format:"* %h %s"
	fi

	echo
	echo
	
	# 5. 生成对比链接
	if [ -n "$current_tag" ]; then
		echo "**Full Changelog**: https://github.com/$repo/compare/$version_range"
	else
		echo "**Full Changelog**: https://github.com"
	fi
} >release.md
